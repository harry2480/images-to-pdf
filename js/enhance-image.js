// AI image enhancement (Real-ESRGAN super-resolution) — UI side.
// Inference runs in js/enhance-worker.js; nothing is downloaded until the user consents on first run.
(() => {
  const {
    isTiff, isHeic, loadDrawable, makeThumbnail, replaceExtension, uniqueName, getOptions,
    downloadBlob, formatBytes, showStatus, hideStatus, showProgress, resetProgress,
  } = PdfApp;

  // iOS Safari's canvas limit is ~16.7M px; keep the output below it. Tune per device if needed.
  const MAX_OUTPUT_PIXELS = 16000000;
  const JPEG_QUALITY = 0.95;
  const DOWNLOAD_MB = { cpu: 19, gpu: 32 };
  const BACKEND_LABEL = { webgpu: 'GPU処理', wasm: 'CPU処理' };
  // Formats an <img> can show directly (for the "before" side of the comparison).
  const NATIVE_PREVIEW = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
  function isAllowed(file) {
    return ALLOWED.includes(file.type) || isTiff(file) || isHeic(file);
  }

  // ── State ──
  let files = [];   // { id, file, card, w, h, failed, ready }
  let nextId = 0;
  let results = []; // { name, blob, url, beforeUrl, w, h }
  let usedNames = new Set();
  let worker = null;
  let workerReady = null; // Promise<backend> resolved once the model is loaded
  let gpuCheck = null;    // Promise<boolean>
  let preferGpu = true;   // dropped after a failed GPU runtime download so a retry uses the self-hosted CPU one
  let consented = false;
  let isProcessing = false;
  let cancelRequested = false;
  let activeJobId = null;
  let nextJobId = 0;

  // ── DOM ──
  const root        = document.querySelector('section[data-tool="enhance"]');
  const dropZone    = document.getElementById('enh-drop-zone');
  const fileInput   = document.getElementById('enh-file-input');
  const selectBtn   = document.getElementById('enh-select-btn');
  const workspace   = document.getElementById('enh-workspace');
  const fileList    = document.getElementById('enh-file-list');
  const addMoreBtn  = document.getElementById('enh-add-more-btn');
  const clearBtn    = document.getElementById('enh-clear');
  const scale4Btn   = document.getElementById('enh-scale-4');
  const scaleHint   = document.getElementById('enh-scale-hint');
  const runBtn      = document.getElementById('enh-run-btn');
  const cancelBtn   = document.getElementById('enh-cancel-btn');
  const consentEl   = document.getElementById('enh-consent');
  const consentText = document.getElementById('enh-consent-text');
  const consentOk   = document.getElementById('enh-consent-ok');
  const consentNo   = document.getElementById('enh-consent-cancel');
  const retryBtn    = document.getElementById('enh-retry-btn');
  const progressEl  = document.getElementById('enh-progress');
  const statusEl    = document.getElementById('enh-status');
  const resultsWrap = document.getElementById('enh-results-wrap');
  const resultsEl   = document.getElementById('enh-results');
  const zipBtn      = document.getElementById('enh-zip-btn');

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

  function addFiles(list) {
    const incoming = Array.from(list).filter(isAllowed);
    if (incoming.length === 0) {
      showStatus(statusEl, 'error', '画像ファイル（JPG・PNG・WebP・GIF・BMP・TIFF・HEIC）を選択してください');
      return;
    }
    hideStatus(statusEl);
    for (const file of incoming) {
      const entry = { id: nextId++, file, w: 0, h: 0, failed: false };
      entry.card = renderCard(entry);
      entry.ready = loadDrawable(file)
        .then(({ w, h }) => { entry.w = w; entry.h = h; })
        .catch(err => { console.error(err); entry.failed = true; })
        .then(() => { updateCardInfo(entry); syncScaleOptions(); });
      files.push(entry);
    }
    dropZone.classList.add('hidden');
    workspace.classList.remove('hidden');
    updateNumbers();
  }

  function fits(entry, scale) {
    return entry.w * entry.h * scale * scale <= MAX_OUTPUT_PIXELS;
  }

  function formatMegapixels(px) {
    return `${Math.round(px / 10000).toLocaleString()}万画素`;
  }

  function renderCard(entry) {
    const card = document.createElement('div');
    card.className = 'file-card';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'file-card-thumb-wrap';
    const thumb = document.createElement('img');
    thumb.className = 'file-card-thumb';
    thumb.alt = entry.file.name;
    makeThumbnail(entry.file).then(url => { thumb.src = url; }).catch(() => {});
    thumbWrap.appendChild(thumb);

    const num = document.createElement('span');
    num.className = 'file-card-num';

    const del = document.createElement('button');
    del.className = 'file-card-delete';
    del.textContent = '×';
    del.title = '削除';
    del.setAttribute('aria-label', `${entry.file.name} を削除`);
    del.addEventListener('click', () => removeFile(entry.id));

    const footer = document.createElement('div');
    footer.className = 'file-card-footer';
    const name = document.createElement('div');
    name.className = 'file-card-name';
    name.textContent = entry.file.name;
    name.title = `${entry.file.name} (${formatBytes(entry.file.size)})`;
    const size = document.createElement('div');
    size.className = 'enh-card-size';
    size.textContent = '読み込み中…';
    footer.appendChild(name);
    footer.appendChild(size);

    card.appendChild(thumbWrap);
    card.appendChild(num);
    card.appendChild(del);
    card.appendChild(footer);
    fileList.appendChild(card);
    return card;
  }

  function updateCardInfo(entry) {
    const size = entry.card.querySelector('.enh-card-size');
    entry.card.classList.remove('enh-card-error');
    if (entry.failed) {
      size.textContent = '読み込めませんでした';
      entry.card.classList.add('enh-card-error');
    } else if (!fits(entry, 2)) {
      size.textContent = `${entry.w}×${entry.h}・大きすぎるため処理できません`;
      entry.card.classList.add('enh-card-error');
    } else {
      size.textContent = `${entry.w}×${entry.h}`;
    }
  }

  // F1-5: a scale is unavailable when any processable image would exceed the output limit.
  function syncScaleOptions() {
    const usable = files.filter(f => f.w && fits(f, 2));
    const too4 = usable.filter(f => !fits(f, 4));
    scale4Btn.disabled = too4.length > 0;
    if (scale4Btn.disabled && scale4Btn.classList.contains('active')) {
      scale4Btn.classList.remove('active');
      root.querySelector('#enh-scale [data-value="2"]').classList.add('active');
    }
    const notes = [];
    if (too4.length) notes.push(`4倍にすると出力が上限（${formatMegapixels(MAX_OUTPUT_PIXELS)}）を超える画像があるため、4倍は選べません`);
    const tooLarge = files.filter(f => f.w && !fits(f, 2)).length;
    if (tooLarge) notes.push(`${tooLarge}枚は2倍でも上限を超えるため、処理されません`);
    scaleHint.textContent = notes.join('。');
    scaleHint.classList.toggle('hidden', notes.length === 0);
  }

  function removeFile(id) {
    if (isProcessing) return;
    const entry = files.find(f => f.id === id);
    if (!entry) return;
    entry.card.remove();
    files = files.filter(f => f !== entry);
    updateNumbers();
    syncScaleOptions();
    if (files.length === 0) resetToDropZone();
  }

  function updateNumbers() {
    files.forEach((f, i) => { f.card.querySelector('.file-card-num').textContent = i + 1; });
  }

  function clearAll() {
    if (isProcessing) return;
    files = [];
    fileList.innerHTML = '';
    syncScaleOptions();
    resetToDropZone();
  }

  function resetToDropZone() {
    if (!consentEl.classList.contains('hidden')) consentNo.click(); // settle the pending prompt
    workspace.classList.add('hidden');
    dropZone.classList.remove('hidden');
    hideStatus(statusEl);
    retryBtn.classList.add('hidden');
  }

  // ── Runtime / model loading ──
  function hasUsableGpu() {
    if (!gpuCheck) {
      gpuCheck = (async () => {
        try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; }
      })();
    }
    return gpuCheck;
  }

  function ensureWorker(runtime) {
    if (workerReady) return workerReady;
    workerReady = new Promise((resolve, reject) => {
      worker = new Worker('js/enhance-worker.js');
      const fail = err => {
        worker.terminate();
        worker = null;
        workerReady = null; // allow retry
        reject(err);
      };
      const onMessage = e => {
        const msg = e.data;
        if (msg.type === 'download') {
          const pct = (msg.loaded / msg.total) * 100;
          showProgress(progressEl, pct, `ダウンロード中 ${formatBytes(msg.loaded)} / ${formatBytes(msg.total)}`);
        } else if (msg.type === 'ready') {
          worker.removeEventListener('message', onMessage);
          worker.removeEventListener('error', onError);
          resolve(msg.backend);
        } else if (msg.type === 'init-error') {
          fail(new Error(msg.message));
        }
      };
      const onError = e => fail(new Error(e.message || 'Worker の起動に失敗しました'));
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ type: 'init', runtime });
    });
    return workerReady;
  }

  function askConsent(runtime) {
    consentText.textContent =
      `初回のみ約${DOWNLOAD_MB[runtime]}MBのデータ（AIモデルと実行環境）をダウンロードします。モバイル回線ではご注意ください。`;
    consentEl.classList.remove('hidden');
    consentOk.focus();
    return new Promise(resolve => {
      const done = ok => {
        consentEl.classList.add('hidden');
        consentOk.removeEventListener('click', yes);
        consentNo.removeEventListener('click', no);
        resolve(ok);
      };
      const yes = () => done(true);
      const no = () => done(false);
      consentOk.addEventListener('click', yes);
      consentNo.addEventListener('click', no);
    });
  }

  // ── Run ──
  runBtn.addEventListener('click', start);
  retryBtn.addEventListener('click', start);
  cancelBtn.addEventListener('click', () => {
    if (!isProcessing || cancelRequested) return;
    cancelRequested = true;
    cancelBtn.disabled = true;
    if (activeJobId !== null) worker.postMessage({ type: 'cancel', jobId: activeJobId });
    showProgress(progressEl, 0, '中断しています…');
  });

  async function start() {
    if (files.length === 0 || isProcessing) return;
    retryBtn.classList.add('hidden');
    hideStatus(statusEl);
    runBtn.disabled = true;
    const runtime = preferGpu && await hasUsableGpu() ? 'gpu' : 'cpu';
    if (!consented) {
      const ok = await askConsent(runtime);
      if (!ok) { runBtn.disabled = false; return; }
      consented = true;
    }

    setProcessing(true);
    try {
      let backend;
      try {
        backend = await ensureWorker(runtime);
      } catch (err) {
        console.error(err);
        if (runtime === 'gpu') preferGpu = false;
        showStatus(statusEl, 'error', 'AIモデルを読み込めませんでした。通信環境を確認して、もう一度お試しください。');
        retryBtn.classList.remove('hidden');
        return;
      }

      await Promise.all(files.map(f => f.ready));
      const scale = Number(getOptions(root).scale) || 2;
      // Snapshot: images added mid-run must not leak into this batch.
      const batch = files.filter(f => f.w && fits(f, scale));
      if (batch.length === 0) {
        showStatus(statusEl, 'error', '処理できる画像がありません');
        return;
      }

      clearResults();
      const failed = [];
      for (let i = 0; i < batch.length && !cancelRequested; i++) {
        try {
          addResult(await enhance(batch[i].file, scale, backend, `${i + 1}/${batch.length}枚目`));
        } catch (err) {
          if (err.name === 'AbortError') break;
          console.error(`高画質化に失敗: ${batch[i].file.name}`, err);
          failed.push(batch[i].file.name);
        }
      }

      let msg = cancelRequested
        ? `中断しました（完了した ${results.length} 枚は下に表示しています）`
        : `${results.length} 枚を ${scale} 倍に高画質化しました（${BACKEND_LABEL[backend]}）`;
      if (failed.length) msg += ` ・ 失敗したファイル: ${failed.join(', ')}`;
      showStatus(statusEl, failed.length ? 'error' : 'success', msg);
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `高画質化できませんでした: ${err.message}`);
    } finally {
      setProcessing(false);
      resetProgress(progressEl);
    }
  }

  function setProcessing(on) {
    isProcessing = on;
    cancelRequested = false;
    runBtn.disabled = on;
    runBtn.classList.toggle('loading', on);
    runBtn.textContent = on ? '処理中' : '高画質化する';
    cancelBtn.classList.toggle('hidden', !on);
    cancelBtn.disabled = false;
    clearBtn.disabled = on;
    zipBtn.disabled = on;
  }

  function hasTransparency(rgba) {
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true;
    return false;
  }

  async function enhance(file, scale, backend, label) {
    const { drawable, w, h } = await loadDrawable(file);
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const sctx = src.getContext('2d');
    sctx.drawImage(drawable, 0, 0);
    const { data } = sctx.getImageData(0, 0, w, h);
    const hasAlpha = hasTransparency(data);
    const beforeBlob = NATIVE_PREVIEW.includes(file.type)
      ? file
      : await new Promise(res => src.toBlob(res, hasAlpha ? 'image/png' : 'image/jpeg', 0.92));
    src.width = src.height = 0; // release the decode canvas early

    const out = document.createElement('canvas');
    out.width = w * scale;
    out.height = h * scale;
    const octx = out.getContext('2d');

    const jobId = nextJobId++;
    activeJobId = jobId;
    const method = BACKEND_LABEL[backend];
    showProgress(progressEl, 0, `${label} タイル 0%（${method}）`);
    try {
      await new Promise((resolve, reject) => {
        const wk = worker;
        const finish = err => {
          wk.removeEventListener('message', onMessage);
          wk.removeEventListener('error', onError);
          err ? reject(err) : resolve();
        };
        const onError = e => finish(new Error(e.message || '処理中にエラーが発生しました'));
        const onMessage = e => {
          const msg = e.data;
          if (msg.jobId !== jobId) return;
          if (msg.type === 'tile') {
            octx.putImageData(new ImageData(new Uint8ClampedArray(msg.rgba), msg.w, msg.h), msg.x, msg.y);
            if (!cancelRequested) {
              const pct = (msg.done / msg.total) * 100;
              showProgress(progressEl, pct, `${label} タイル ${Math.round(pct)}%（${method}）`);
            }
          } else if (msg.type === 'done') {
            finish();
          } else if (msg.type === 'cancelled') {
            finish(new DOMException('中断しました', 'AbortError'));
          } else if (msg.type === 'error') {
            finish(new Error(msg.message));
          }
        };
        wk.addEventListener('message', onMessage);
        wk.addEventListener('error', onError);
        wk.postMessage({ type: 'run', jobId, width: w, height: h, rgba: data.buffer, scale, hasAlpha }, [data.buffer]);
      });
    } catch (err) {
      out.width = out.height = 0; // a cancelled image is discarded (F4-6)
      throw err;
    } finally {
      activeJobId = null;
    }

    // PNG stays PNG; transparency also forces PNG so it isn't flattened. Everything else → JPEG.
    const isPng = file.type === 'image/png' || hasAlpha;
    const mime = isPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(res => out.toBlob(res, mime, isPng ? undefined : JPEG_QUALITY));
    out.width = out.height = 0;
    if (!blob) throw new Error('画像の書き出しに失敗しました');
    const name = uniqueName(
      replaceExtension(file.name, isPng ? 'png' : 'jpg').replace(/(\.[^.]+)$/, `_x${scale}$1`),
      usedNames,
    );
    return { name, blob, beforeBlob, w: w * scale, h: h * scale };
  }

  // ── Results ──
  function clearResults() {
    for (const r of results) {
      URL.revokeObjectURL(r.url);
      URL.revokeObjectURL(r.beforeUrl);
    }
    results = [];
    usedNames = new Set();
    resultsEl.innerHTML = '';
    resultsWrap.classList.add('hidden');
  }

  function addResult({ name, blob, beforeBlob, w, h }) {
    const r = { name, blob, w, h, url: URL.createObjectURL(blob), beforeUrl: URL.createObjectURL(beforeBlob) };
    results.push(r);
    resultsWrap.classList.remove('hidden');
    zipBtn.classList.toggle('hidden', results.length < 2);

    const item = document.createElement('div');
    item.className = 'enh-result';

    const img = document.createElement('img');
    img.className = 'enh-result-img';
    img.src = r.url;
    img.alt = `${name}（高画質化後）`;

    const info = document.createElement('div');
    info.className = 'enh-result-info';
    const title = document.createElement('div');
    title.className = 'enh-result-name';
    title.textContent = name;
    const meta = document.createElement('div');
    meta.className = 'enh-result-meta';
    meta.textContent = `${w}×${h} ・ ${formatBytes(blob.size)}`;
    info.appendChild(title);
    info.appendChild(meta);

    const compare = document.createElement('button');
    compare.className = 'batch-btn';
    compare.textContent = '比較';
    compare.setAttribute('aria-label', `${name} の変換前後を比較`);
    compare.addEventListener('click', () => openCompare(r, compare));

    const save = document.createElement('button');
    save.className = 'batch-btn';
    save.textContent = '保存';
    save.setAttribute('aria-label', `${name} を保存`);
    save.addEventListener('click', () => downloadBlob(blob, name));

    item.appendChild(img);
    item.appendChild(info);
    item.appendChild(compare);
    item.appendChild(save);
    resultsEl.appendChild(item);
  }

  zipBtn.addEventListener('click', async () => {
    if (results.length === 0) return;
    zipBtn.disabled = true;
    try {
      const entries = {};
      for (const r of results) entries[r.name] = new Uint8Array(await r.blob.arrayBuffer());
      // Images are already compressed → store (level 0) to keep zipping fast.
      const zipped = fflate.zipSync(entries, { level: 0 });
      downloadBlob(new Blob([zipped], { type: 'application/zip' }), 'enhanced_images.zip');
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `ZIP を作成できませんでした: ${err.message}`);
    } finally {
      zipBtn.disabled = false;
    }
  });

  // ── Before / after comparison (F5-1) ──
  const compareModal   = document.getElementById('enh-compare-modal');
  const compareTitle   = document.getElementById('enh-compare-title');
  const compareBox     = document.getElementById('enh-compare');
  const compareAfter   = document.getElementById('enh-compare-after');
  const compareBefore  = document.getElementById('enh-compare-before');
  const compareClip    = document.getElementById('enh-compare-before-wrap');
  const compareDivider = document.getElementById('enh-compare-divider');
  const compareRange   = document.getElementById('enh-compare-range');
  const compareToggle  = document.getElementById('enh-compare-toggle');
  const compareState   = document.getElementById('enh-compare-state');
  // Narrow screens swap the slider for tap-to-toggle (dragging fights with page scrolling there).
  const narrowMq = window.matchMedia('(max-width: 600px)');
  let compareTrigger = null;
  let dragging = false;

  function setComparePos(pct) {
    pct = Math.min(100, Math.max(0, pct));
    compareClip.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    compareDivider.style.left = `${pct}%`;
    compareRange.value = pct;
  }

  function setShowBefore(on) {
    setComparePos(on ? 100 : 0);
    compareToggle.setAttribute('aria-pressed', String(on));
    compareState.textContent = on ? '元画像' : '高画質化後';
  }

  function resetCompareMode() {
    if (narrowMq.matches) setShowBefore(false);
    else setComparePos(50);
  }

  function openCompare(r, trigger) {
    compareTrigger = trigger;
    compareTitle.textContent = `比較：${r.name}`;
    compareAfter.src = r.url;
    compareBefore.src = r.beforeUrl;
    compareBox.style.aspectRatio = `${r.w} / ${r.h}`;
    compareBox.style.width = `min(100%, calc(65vh * ${r.w / r.h}))`;
    resetCompareMode();
    compareModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    (narrowMq.matches ? compareToggle : compareRange).focus();
  }

  function closeCompare() {
    compareModal.classList.add('hidden');
    document.body.style.overflow = '';
    compareAfter.removeAttribute('src');
    compareBefore.removeAttribute('src');
    if (compareTrigger) compareTrigger.focus();
  }

  compareRange.addEventListener('input', () => setComparePos(Number(compareRange.value)));
  compareToggle.addEventListener('click', () => setShowBefore(compareToggle.getAttribute('aria-pressed') !== 'true'));
  compareBox.addEventListener('click', () => {
    if (narrowMq.matches) compareToggle.click();
  });
  const posFromEvent = e => {
    const rect = compareBox.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * 100;
  };
  compareBox.addEventListener('pointerdown', e => {
    if (narrowMq.matches) return;
    dragging = true;
    compareBox.setPointerCapture(e.pointerId);
    setComparePos(posFromEvent(e));
  });
  compareBox.addEventListener('pointermove', e => { if (dragging) setComparePos(posFromEvent(e)); });
  compareBox.addEventListener('pointerup', () => { dragging = false; });
  compareBox.addEventListener('pointercancel', () => { dragging = false; });
  narrowMq.addEventListener('change', resetCompareMode);
  document.getElementById('enh-compare-close').addEventListener('click', closeCompare);
  document.getElementById('enh-compare-overlay').addEventListener('click', closeCompare);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !compareModal.classList.contains('hidden')) closeCompare();
  });
})();
