// AI image enhancement (Real-ESRGAN super-resolution) — UI side.
// Inference runs in js/enhance-worker.js; nothing is downloaded until the user consents on first run.
(() => {
  const {
    isTiff, isHeic, loadDrawable, makeThumbnail, replaceExtension, uniqueName,
    downloadBlob, formatBytes, showStatus, hideStatus, showProgress, resetProgress,
  } = PdfApp;

  // iOS Safari's canvas limit is ~16.7M px; keep the output below it. Tune per device if needed.
  const MAX_OUTPUT_PIXELS = 16000000;
  const SCALE = 2;
  const DOWNLOAD_MB = 19;
  const JPEG_QUALITY = 0.95;

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
  function isAllowed(file) {
    return ALLOWED.includes(file.type) || isTiff(file) || isHeic(file);
  }

  // ── State ──
  let current = null;   // { file, w, h }
  let worker = null;
  let workerReady = null; // Promise resolved once the model is loaded
  let consented = false;
  let isProcessing = false;
  let nextJobId = 0;
  const usedNames = new Set();

  // ── DOM ──
  const dropZone    = document.getElementById('enh-drop-zone');
  const fileInput   = document.getElementById('enh-file-input');
  const selectBtn   = document.getElementById('enh-select-btn');
  const workspace   = document.getElementById('enh-workspace');
  const fileList    = document.getElementById('enh-file-list');
  const clearBtn    = document.getElementById('enh-clear');
  const runBtn      = document.getElementById('enh-run-btn');
  const consentEl   = document.getElementById('enh-consent');
  const consentText = document.getElementById('enh-consent-text');
  const consentOk   = document.getElementById('enh-consent-ok');
  const consentNo   = document.getElementById('enh-consent-cancel');
  const retryBtn    = document.getElementById('enh-retry-btn');
  const progressEl  = document.getElementById('enh-progress');
  const statusEl    = document.getElementById('enh-status');
  const resultsEl   = document.getElementById('enh-results');

  // ── File input / drag-drop ──
  selectBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) setFile(e.target.files[0]);
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
    const file = Array.from(e.dataTransfer.files).find(isAllowed);
    if (file) setFile(file);
  });
  clearBtn.addEventListener('click', clearFile);

  async function setFile(file) {
    if (isProcessing) return;
    if (!isAllowed(file)) {
      showStatus(statusEl, 'error', '画像ファイル（JPG・PNG・WebP・GIF・BMP・TIFF・HEIC）を選択してください');
      return;
    }
    hideStatus(statusEl);
    retryBtn.classList.add('hidden');
    dropZone.classList.add('hidden');
    workspace.classList.remove('hidden');
    fileList.innerHTML = '';
    const card = renderCard(file);
    current = { file, w: 0, h: 0 };
    runBtn.disabled = true;
    try {
      const { w, h } = await loadDrawable(file);
      if (current?.file !== file) return;
      current.w = w;
      current.h = h;
      card.querySelector('.enh-card-size').textContent = `${w}×${h} → ${w * SCALE}×${h * SCALE}`;
      if (w * h * SCALE * SCALE > MAX_OUTPUT_PIXELS) {
        showStatus(statusEl, 'error',
          `画像が大きすぎます。2倍にすると ${formatMegapixels(w * h * SCALE * SCALE)} になり、上限の ${formatMegapixels(MAX_OUTPUT_PIXELS)} を超えます`);
        return;
      }
      runBtn.disabled = false;
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `画像を読み込めませんでした: ${err.message}`);
    }
  }

  function formatMegapixels(px) {
    return `${Math.round(px / 10000).toLocaleString()}万画素`;
  }

  function renderCard(file) {
    const card = document.createElement('div');
    card.className = 'file-card';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'file-card-thumb-wrap';
    const thumb = document.createElement('img');
    thumb.className = 'file-card-thumb';
    thumb.alt = file.name;
    makeThumbnail(file).then(url => { thumb.src = url; }).catch(() => {});
    thumbWrap.appendChild(thumb);

    const footer = document.createElement('div');
    footer.className = 'file-card-footer';
    const name = document.createElement('div');
    name.className = 'file-card-name';
    name.textContent = file.name;
    name.title = `${file.name} (${formatBytes(file.size)})`;
    const size = document.createElement('div');
    size.className = 'enh-card-size';
    footer.appendChild(name);
    footer.appendChild(size);

    card.appendChild(thumbWrap);
    card.appendChild(footer);
    fileList.appendChild(card);
    return card;
  }

  function clearFile() {
    if (isProcessing) return;
    if (!consentEl.classList.contains('hidden')) consentNo.click(); // settle the pending prompt
    current = null;
    fileList.innerHTML = '';
    workspace.classList.add('hidden');
    dropZone.classList.remove('hidden');
    hideStatus(statusEl);
  }

  // ── Runtime / model loading ──
  function ensureWorker() {
    if (workerReady) return workerReady;
    workerReady = new Promise((resolve, reject) => {
      worker = new Worker('js/enhance-worker.js');
      const onMessage = e => {
        const msg = e.data;
        if (msg.type === 'download') {
          const pct = (msg.loaded / msg.total) * 100;
          showProgress(progressEl, pct, `ダウンロード中 ${formatBytes(msg.loaded)} / ${formatBytes(msg.total)}`);
        } else if (msg.type === 'ready') {
          worker.removeEventListener('message', onMessage);
          resolve();
        } else if (msg.type === 'init-error') {
          fail(new Error(msg.message));
        }
      };
      const fail = err => {
        worker.terminate();
        worker = null;
        workerReady = null; // allow retry
        reject(err);
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', e => fail(new Error(e.message || 'Worker の起動に失敗しました')));
      worker.postMessage({ type: 'init' });
    });
    return workerReady;
  }

  function askConsent() {
    consentText.textContent =
      `初回のみ約${DOWNLOAD_MB}MBのデータ（AIモデルと実行環境）をダウンロードします。モバイル回線ではご注意ください。`;
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

  async function start() {
    if (!current || isProcessing) return;
    retryBtn.classList.add('hidden');
    hideStatus(statusEl);
    if (!consented) {
      runBtn.disabled = true;
      const ok = await askConsent();
      runBtn.disabled = false;
      if (!ok) return;
      consented = true;
    }

    setProcessing(true);
    try {
      try {
        await ensureWorker();
      } catch (err) {
        console.error(err);
        showStatus(statusEl, 'error', 'AIモデルを読み込めませんでした。通信環境を確認して、もう一度お試しください。');
        retryBtn.classList.remove('hidden');
        return;
      }
      const result = await enhance(current.file);
      addResult(result);
      showStatus(statusEl, 'success', `${result.name} を作成しました（${formatBytes(result.blob.size)}）`);
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
    runBtn.disabled = on;
    runBtn.classList.toggle('loading', on);
    runBtn.textContent = on ? '処理中' : '高画質化する';
    clearBtn.disabled = on;
  }

  async function enhance(file) {
    const { drawable, w, h } = await loadDrawable(file);
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const sctx = src.getContext('2d');
    sctx.drawImage(drawable, 0, 0);
    const { data } = sctx.getImageData(0, 0, w, h);
    src.width = src.height = 0; // release the decode canvas early

    const out = document.createElement('canvas');
    out.width = w * SCALE;
    out.height = h * SCALE;
    const octx = out.getContext('2d');

    const jobId = nextJobId++;
    showProgress(progressEl, 0, '高画質化中 0%');
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
          const pct = (msg.done / msg.total) * 100;
          showProgress(progressEl, pct, `高画質化中 ${Math.round(pct)}%（CPU処理）`);
        } else if (msg.type === 'done') {
          finish();
        } else if (msg.type === 'error') {
          finish(new Error(msg.message));
        }
      };
      wk.addEventListener('message', onMessage);
      wk.addEventListener('error', onError);
      wk.postMessage({ type: 'run', jobId, width: w, height: h, rgba: data.buffer, scale: SCALE }, [data.buffer]);
    });

    // PNG stays PNG (lossless / may carry transparency later); everything else → high-quality JPEG.
    const isPng = file.type === 'image/png';
    const mime = isPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(res => out.toBlob(res, mime, isPng ? undefined : JPEG_QUALITY));
    out.width = out.height = 0;
    if (!blob) throw new Error('画像の書き出しに失敗しました');
    const name = uniqueName(
      replaceExtension(file.name, isPng ? 'png' : 'jpg').replace(/(\.[^.]+)$/, `_x${SCALE}$1`),
      usedNames,
    );
    return { name, blob, w: w * SCALE, h: h * SCALE };
  }

  // ── Results ──
  function addResult({ name, blob, w, h }) {
    resultsEl.classList.remove('hidden');
    const item = document.createElement('div');
    item.className = 'enh-result';

    const url = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.className = 'enh-result-img';
    img.src = url;
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

    const save = document.createElement('button');
    save.className = 'batch-btn';
    save.textContent = '保存';
    save.setAttribute('aria-label', `${name} を保存`);
    save.addEventListener('click', () => downloadBlob(blob, name));

    item.appendChild(img);
    item.appendChild(info);
    item.appendChild(save);
    resultsEl.prepend(item);
  }
})();
