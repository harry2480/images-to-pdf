// Image → image format conversion (JPG / PNG / WebP). Multi-file output is zipped with fflate.
(() => {
  const {
    QUALITY_MAP, IMAGE_OUTPUT_FORMATS, replaceExtension, uniqueName, canEncodeImage,
    getOptions, imageViaCanvas, isTiff, isHeic, makeThumbnail,
    downloadBlob, formatBytes, showStatus, hideStatus, showProgress, resetProgress,
  } = PdfApp;

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
  function isAllowed(file) {
    // TIFF/HEIC often report empty MIME → also accept by extension.
    return ALLOWED.includes(file.type) || isTiff(file) || isHeic(file);
  }

  // ── State ──
  let files = []; // { id, file }
  let nextId = 0;

  // ── DOM ──
  const root         = document.querySelector('section[data-tool="image-convert"]');
  const dropZone     = document.getElementById('ic-drop-zone');
  const fileInput    = document.getElementById('ic-file-input');
  const selectBtn    = document.getElementById('ic-select-btn');
  const workspace    = document.getElementById('ic-workspace');
  const fileList     = document.getElementById('ic-file-list');
  const addMoreBtn   = document.getElementById('ic-add-more-btn');
  const clearBtn     = document.getElementById('ic-clear');
  const formatGroup  = document.getElementById('ic-format');
  const webpBtn      = document.getElementById('ic-format-webp');
  const qualityGroup = document.getElementById('ic-quality-group');
  const convertBtn   = document.getElementById('ic-convert-btn');
  const statusEl     = document.getElementById('ic-status');
  const progressEl   = document.getElementById('ic-progress');

  // ── Format availability ──
  if (!canEncodeImage('image/webp')) {
    webpBtn.disabled = true;
    webpBtn.title = 'このブラウザは WebP 出力に対応していません';
  }

  // Quality only applies to lossy formats. Runs after the shared .active toggle (bound earlier).
  function syncQualityVisibility() {
    const fmt = IMAGE_OUTPUT_FORMATS[getOptions(root).format];
    qualityGroup.classList.toggle('hidden', !!fmt && !fmt.lossy);
  }
  formatGroup.addEventListener('click', syncQualityVisibility);

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

  // ── Add files ──
  function addFiles(fileList_) {
    const incoming = Array.from(fileList_).filter(isAllowed);

    for (const file of incoming) {
      const id = nextId++;
      files.push({ id, file });
      renderCard({ id, file });
    }

    if (files.length > 0) showWorkspace();
    updateNumbers();
    if (incoming.some(isHeic)) {
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
    card.className = 'file-card';
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
    del.textContent = '×';
    del.addEventListener('click', e => { e.stopPropagation(); removeFile(id, card); });

    const footer = document.createElement('div');
    footer.className = 'file-card-footer';
    const name = document.createElement('div');
    name.className = 'file-card-name';
    name.textContent = file.name; // textContent: never inject filename as HTML
    name.title = `${file.name} (${formatBytes(file.size)})`;
    footer.appendChild(name);

    card.appendChild(thumbWrap);
    card.appendChild(num);
    card.appendChild(del);
    card.appendChild(footer);
    fileList.appendChild(card);
  }

  function removeFile(id, card) {
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
    files = [];
    fileList.innerHTML = '';
    resetToDropZone();
  }

  // ── Convert ──
  // Converts every file independently so one broken image doesn't sink the batch.
  async function convertAll(entries, fmt, qualityVal) {
    const used = new Set();
    const outputs = []; // { name, bytes }
    const failed = [];  // source filenames
    let i = 0;
    for (const { file } of entries) {
      try {
        const { bytes, type } = await imageViaCanvas(file, 0, qualityVal, fmt.mime);
        // toBlob silently falls back to PNG for unsupported types; don't mislabel that output.
        if (type !== fmt.mime) throw new Error(`このブラウザは ${fmt.ext.toUpperCase()} 出力に対応していません`);
        const name = uniqueName(replaceExtension(file.name, fmt.ext), used);
        outputs.push({ name, bytes: new Uint8Array(bytes) });
      } catch (err) {
        console.error(`変換失敗: ${file.name}`, err);
        failed.push(file.name);
      }
      i++;
      showProgress(progressEl, (i / entries.length) * 100);
    }
    return { outputs, failed };
  }

  convertBtn.addEventListener('click', async () => {
    if (files.length === 0) return;

    const opts = getOptions(root);
    const fmt = IMAGE_OUTPUT_FORMATS[opts.format] || IMAGE_OUTPUT_FORMATS.jpeg;
    const qualityVal = fmt.lossy ? (QUALITY_MAP[opts.quality] ?? 0.92) : undefined;

    convertBtn.disabled = true;
    convertBtn.classList.add('loading');
    convertBtn.textContent = '変換中';
    hideStatus(statusEl);
    resetProgress(progressEl);

    try {
      // Snapshot: files added via "+ 画像を追加" mid-conversion must not leak into this batch.
      const entries = files.slice();
      const { outputs, failed } = await convertAll(entries, fmt, qualityVal);

      if (outputs.length === 0) {
        showStatus(statusEl, 'error', `変換できませんでした: ${failed.join(', ')}`);
        return;
      }

      let msg;
      if (outputs.length === 1) {
        downloadBlob(new Blob([outputs[0].bytes], { type: fmt.mime }), outputs[0].name);
        msg = `${outputs[0].name} に変換しました（${formatBytes(outputs[0].bytes.length)}）`;
      } else {
        const zipObj = {};
        outputs.forEach(o => { zipObj[o.name] = o.bytes; });
        // Images are already compressed → store (level 0) to keep zipping fast.
        const zipped = fflate.zipSync(zipObj, { level: 0 });
        downloadBlob(new Blob([zipped], { type: 'application/zip' }), `converted_${fmt.ext}.zip`);
        msg = `${outputs.length} 枚を ${fmt.ext.toUpperCase()} に変換し ZIP にまとめました（${formatBytes(zipped.length)}）`;
      }
      if (failed.length > 0) {
        showStatus(statusEl, 'error', `${msg} ・ 変換できなかったファイル: ${failed.join(', ')}`);
      } else {
        showStatus(statusEl, 'success', msg);
      }
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `エラーが発生しました: ${err.message}`);
    } finally {
      convertBtn.disabled = false;
      convertBtn.classList.remove('loading');
      convertBtn.textContent = '変換する';
      resetProgress(progressEl);
    }
  });
})();
