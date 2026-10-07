// Image compression: re-encode each image at a lower quality, keeping its size in pixels.
// Multi-file output is zipped with fflate.
(() => {
  const {
    IMAGE_OUTPUT_FORMATS, replaceExtension, uniqueName, canEncodeImage,
    getOptions, imageViaCanvas, isTiff, isHeic, makeThumbnail,
    downloadBlob, formatBytes, showStatus, hideStatus, showProgress, resetProgress,
  } = PdfApp;

  // ── Pure helpers (kept in sync with js/utils.js, which is test-only) ──
  const COMPRESS_LEVELS = { strong: 0.5, medium: 0.7, light: 0.85 };

  // Which IMAGE_OUTPUT_FORMATS key to encode to. "original" keeps JPG/PNG/WebP;
  // formats the canvas can't write (GIF/BMP/TIFF/HEIC) fall back to JPEG.
  function resolveCompressFormat(file, choice, canWebp) {
    if (choice === 'jpeg') return 'jpeg';
    if (choice === 'webp') return canWebp ? 'webp' : 'jpeg';
    const name = file.name || '';
    if (file.type === 'image/png' || /\.png$/i.test(name)) return 'png';
    if (file.type === 'image/webp' || /\.webp$/i.test(name)) return canWebp ? 'webp' : 'jpeg';
    return 'jpeg';
  }

  // A compressor must never hand back a bigger file unless the user asked for a new format:
  // same-format re-encodes (already-optimised JPG, PNG) and "original"-mode fallbacks
  // (HEIC/GIF → JPEG) can both grow, and then the untouched original is the better result.
  function shouldKeepOriginal(file, fmtKey, newSize, choice) {
    if (newSize < file.size) return false;
    return choice === 'original' || isSameFormat(file, fmtKey);
  }

  function isSameFormat(file, fmtKey) {
    const name = file.name || '';
    if (fmtKey === 'jpeg') return file.type === 'image/jpeg' || /\.jpe?g$/i.test(name);
    if (fmtKey === 'png')  return file.type === 'image/png'  || /\.png$/i.test(name);
    if (fmtKey === 'webp') return file.type === 'image/webp' || /\.webp$/i.test(name);
    return false;
  }

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
  function isAllowed(file) {
    // TIFF/HEIC often report empty MIME → also accept by extension.
    return ALLOWED.includes(file.type) || isTiff(file) || isHeic(file);
  }

  // ── State ──
  let files = []; // { id, file }
  let nextId = 0;
  // Deleting while a batch runs would silently leave the image in the download, so deletion is locked.
  let isCompressing = false;
  const canWebp = canEncodeImage('image/webp');

  // ── DOM ──
  const root        = document.querySelector('section[data-tool="compress-image"]');
  const dropZone    = document.getElementById('ci-drop-zone');
  const fileInput   = document.getElementById('ci-file-input');
  const selectBtn   = document.getElementById('ci-select-btn');
  const workspace   = document.getElementById('ci-workspace');
  const fileList    = document.getElementById('ci-file-list');
  const addMoreBtn  = document.getElementById('ci-add-more-btn');
  const clearBtn    = document.getElementById('ci-clear');
  const webpBtn     = document.getElementById('ci-format-webp');
  const compressBtn = document.getElementById('ci-btn');
  const statusEl    = document.getElementById('ci-status');
  const progressEl  = document.getElementById('ci-progress');

  if (!canWebp) {
    webpBtn.disabled = true;
    webpBtn.title = 'このブラウザは WebP 出力に対応していません';
  }

  // ── File input / drag-drop ──
  selectBtn.addEventListener('click', () => fileInput.click());
  addMoreBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    addFiles(e.target.files);
    e.target.value = '';
  });
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    addFiles(e.dataTransfer.files);
  });
  clearBtn.addEventListener('click', clearAll);

  function addFiles(fileList_) {
    const all = Array.from(fileList_);
    const incoming = all.filter(isAllowed);
    for (const file of incoming) {
      const id = nextId++;
      files.push({ id, file });
      renderCard({ id, file });
    }
    if (files.length > 0) showWorkspace();
    updateNumbers();
    if (incoming.length < all.length) {
      // Status lives outside the workspace so this is visible even with zero images added.
      showStatus(statusEl, 'error', '対応していない形式のファイルは追加されませんでした');
    } else if (incoming.some(isHeic)) {
      showStatus(statusEl, 'success', 'HEIC を変換中です…（初回は読み込みに時間がかかります）');
      setTimeout(() => { if (statusEl.textContent.startsWith('HEIC')) hideStatus(statusEl); }, 6000);
    }
  }

  function showWorkspace() {
    dropZone.classList.add('hidden');
    workspace.classList.remove('hidden');
  }

  function resetToDropZone() {
    workspace.classList.add('hidden');
    dropZone.classList.remove('hidden');
    hideStatus(statusEl);
  }

  // ── Render card ──
  function renderCard({ id, file }) {
    const card = document.createElement('div');
    card.className = 'file-card ci-card';
    card.dataset.id = id;

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'file-card-thumb-wrap';
    const thumb = document.createElement('img');
    thumb.className = 'file-card-thumb';
    thumb.alt = file.name;
    makeThumbnail(file).then(url => { thumb.src = url; }).catch(() => {});
    thumbWrap.appendChild(thumb);

    const num = document.createElement('span');
    num.className = 'file-card-num';

    const del = document.createElement('button');
    del.className = 'file-card-delete';
    del.title = '削除';
    del.setAttribute('aria-label', `${file.name} を削除`);
    del.textContent = '×';
    del.addEventListener('click', e => { e.stopPropagation(); removeFile(id, card); });

    const footer = document.createElement('div');
    footer.className = 'file-card-footer';
    const name = document.createElement('div');
    name.className = 'file-card-name';
    name.textContent = file.name; // textContent: never inject filename as HTML
    name.title = file.name;
    const size = document.createElement('div');
    size.className = 'ci-card-size';
    size.textContent = formatBytes(file.size);
    footer.appendChild(name);
    footer.appendChild(size);

    card.appendChild(thumbWrap);
    card.appendChild(num);
    card.appendChild(del);
    card.appendChild(footer);
    fileList.appendChild(card);
  }

  function setCardResult(id, text, state) {
    const card = fileList.querySelector(`.file-card[data-id="${id}"]`);
    if (!card) return; // removed while compressing
    const size = card.querySelector('.ci-card-size');
    size.textContent = text;
    card.classList.toggle('ci-card-done', state === 'done');
    card.classList.toggle('ci-card-warn', state === 'warn');
    card.classList.toggle('ci-card-error', state === 'error');
  }

  function removeFile(id, card) {
    if (isCompressing) return;
    files = files.filter(f => f.id !== id);
    card.remove();
    updateNumbers();
    if (files.length === 0) resetToDropZone();
  }

  function updateNumbers() {
    fileList.querySelectorAll('.file-card').forEach((card, i) => {
      card.querySelector('.file-card-num').textContent = i + 1;
    });
  }

  function clearAll() {
    if (isCompressing) return;
    files = [];
    fileList.innerHTML = '';
    resetToDropZone();
  }

  function reductionLabel(before, after) {
    const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
    return pct > 0 ? `−${pct}%` : `+${-pct}%`;
  }

  // ── Compress ──
  // Each file is handled independently so one broken image doesn't sink the batch.
  async function compressAll(entries, quality, formatChoice) {
    const used = new Set();
    const outputs = []; // { name, data: Uint8Array | File, size, mime, before, kept }
    const failed = [];  // source filenames
    let i = 0;
    for (const { id, file } of entries) {
      try {
        const fmtKey = resolveCompressFormat(file, formatChoice, canWebp);
        const fmt = IMAGE_OUTPUT_FORMATS[fmtKey];
        const { bytes, type } = await imageViaCanvas(file, 0, fmt.lossy ? quality : undefined, fmt.mime);
        // toBlob silently falls back to PNG for unsupported types; don't mislabel that output.
        if (type !== fmt.mime) throw new Error(`このブラウザは ${fmt.ext.toUpperCase()} 出力に対応していません`);

        if (shouldKeepOriginal(file, fmtKey, bytes.byteLength, formatChoice)) {
          // Keep the File itself; it is only read if it has to go into a ZIP.
          outputs.push({
            name: uniqueName(file.name, used), data: file, size: file.size,
            mime: file.type || 'application/octet-stream', before: file.size, kept: true,
          });
          setCardResult(id, `${formatBytes(file.size)}（これ以上縮みません）`, 'done');
        } else {
          const size = bytes.byteLength;
          outputs.push({
            name: uniqueName(replaceExtension(file.name, fmt.ext), used), data: new Uint8Array(bytes), size,
            mime: fmt.mime, before: file.size, kept: false,
          });
          const label = `${formatBytes(file.size)} → ${formatBytes(size)}（${reductionLabel(file.size, size)}）`;
          // Only reachable with an explicit JPG/WebP choice: the user asked for that format, so deliver it but flag it.
          setCardResult(id, size >= file.size ? `${label} 元より大きくなりました` : label, size >= file.size ? 'warn' : 'done');
        }
      } catch (err) {
        console.error(`圧縮失敗: ${file.name}`, err);
        failed.push(file.name);
        setCardResult(id, `圧縮できませんでした（${err.message}）`, 'error');
      }
      i++;
      showProgress(progressEl, (i / entries.length) * 100);
    }
    return { outputs, failed };
  }

  compressBtn.addEventListener('click', async () => {
    if (files.length === 0) return;

    const opts = getOptions(root);
    const quality = COMPRESS_LEVELS[opts.level] ?? COMPRESS_LEVELS.medium;

    isCompressing = true;
    clearBtn.disabled = true;
    fileList.classList.add('ci-busy');
    compressBtn.disabled = true;
    compressBtn.classList.add('loading');
    compressBtn.textContent = '圧縮中';
    hideStatus(statusEl);
    resetProgress(progressEl);

    try {
      // Snapshot: files added via "+ 画像を追加" mid-run must not leak into this batch.
      const entries = files.slice();
      const { outputs, failed } = await compressAll(entries, quality, opts.format);

      if (outputs.length === 0) {
        showStatus(statusEl, 'error', `圧縮できませんでした: ${failed.join(', ')}`);
        return;
      }

      if (outputs.every(o => o.kept)) {
        // Nothing got smaller: downloading identical copies would only look like a success.
        const msg = 'これ以上縮められませんでした。出力形式を JPG か WebP に変えるか、圧縮率を「強」にしてください';
        showStatus(statusEl, 'error', failed.length > 0 ? `${msg} ・ 圧縮できなかったファイル: ${failed.join(', ')}` : msg);
        return;
      }

      const before = outputs.reduce((s, o) => s + o.before, 0);
      const after = outputs.reduce((s, o) => s + o.size, 0);
      const total = `${formatBytes(before)} → ${formatBytes(after)}（${reductionLabel(before, after)}）`;

      let msg;
      if (outputs.length === 1) {
        downloadBlob(new Blob([outputs[0].data], { type: outputs[0].mime }), outputs[0].name);
        msg = `${outputs[0].name} を圧縮しました：${total}`;
      } else {
        const zipObj = {};
        for (const o of outputs) {
          zipObj[o.name] = o.data instanceof Uint8Array ? o.data : new Uint8Array(await o.data.arrayBuffer());
        }
        // Images are already compressed → store (level 0) to keep zipping fast.
        const zipped = fflate.zipSync(zipObj, { level: 0 });
        downloadBlob(new Blob([zipped], { type: 'application/zip' }), 'compressed_images.zip');
        msg = `${outputs.length} 枚を圧縮し ZIP にまとめました：合計 ${total}`;
      }
      if (outputs.some(o => !o.kept && o.size >= o.before)) {
        msg += ' ・ 元より大きくなった画像があります（「元の形式」を選ぶと元のファイルのまま出力します）';
      }
      if (failed.length > 0) {
        showStatus(statusEl, 'error', `${msg} ・ 圧縮できなかったファイル: ${failed.join(', ')}`);
      } else {
        showStatus(statusEl, 'success', msg);
      }
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `エラーが発生しました: ${err.message}`);
    } finally {
      isCompressing = false;
      clearBtn.disabled = false;
      fileList.classList.remove('ci-busy');
      compressBtn.disabled = false;
      compressBtn.classList.remove('loading');
      compressBtn.textContent = '圧縮する';
      resetProgress(progressEl);
    }
  });
})();
