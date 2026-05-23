// Shared utilities exposed as window.PdfApp — used by every tool.
window.PdfApp = (() => {
  const { PDFDocument } = PDFLib;

  // pt per mm (1pt = 1/72 inch, 1 inch = 25.4mm)
  const MM_TO_PT = 72 / 25.4;
  const PAGE_SIZES = {
    a3:     [297 * MM_TO_PT, 420 * MM_TO_PT],
    a4:     [210 * MM_TO_PT, 297 * MM_TO_PT],
    a5:     [148 * MM_TO_PT, 210 * MM_TO_PT],
    b5:     [176 * MM_TO_PT, 250 * MM_TO_PT],
    letter: [215.9 * MM_TO_PT, 279.4 * MM_TO_PT],
  };
  const MARGIN_PT   = { none: 0, small: 14, large: 28 };
  const QUALITY_MAP = { high: 0.92, medium: 0.75, small: 0.45 };

  // Resource limits (self-DoS guard for fully client-side processing)
  const MAX_FILES = 200;
  const MAX_TOTAL_BYTES = 300 * 1024 * 1024; // 300MB

  // ── Formatting ──
  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ── Options (scoped per tool section) ──
  // Reads every .option-buttons[data-opt] under rootEl into a key/value object.
  function getOptions(rootEl) {
    const opts = {};
    rootEl.querySelectorAll('.option-buttons[data-opt]').forEach(group => {
      const active = group.querySelector('.opt-btn.active');
      if (active) opts[group.dataset.opt] = active.dataset.value;
    });
    return opts;
  }

  // Toggle .active within a button group on click. Bound once for all groups.
  function initOptionButtons() {
    document.querySelectorAll('.option-buttons').forEach(group => {
      group.addEventListener('click', e => {
        const btn = e.target.closest('.opt-btn');
        if (!btn) return;
        group.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  // ── PDF layout ──
  function calcLayout(image, options, marginPt) {
    const landscape = options.orientation === 'landscape';

    if (options.pageSize === 'fit') {
      let w = image.width;
      let h = image.height;
      if (landscape && w < h) { [w, h] = [h, w]; }
      if (!landscape && w > h) { [w, h] = [h, w]; }
      const imgW = w - marginPt * 2;
      const imgH = h - marginPt * 2;
      return { width: w, height: h, imgW, imgH };
    }

    let [baseW, baseH] = PAGE_SIZES[options.pageSize];
    if (landscape) { [baseW, baseH] = [baseH, baseW]; }

    const maxW = baseW - marginPt * 2;
    const maxH = baseH - marginPt * 2;
    const ratio = Math.min(maxW / image.width, maxH / image.height);
    const imgW = image.width * ratio;
    const imgH = image.height * ratio;

    const x = marginPt + (maxW - imgW) / 2;
    const y = marginPt + (maxH - imgH) / 2;

    return { width: baseW, height: baseH, imgW, imgH, x, y };
  }

  // ── Image decoding / re-encoding ──
  async function processImageFile({ file, rotation = 0 }, qualityVal) {
    // Fast path only for unrotated, high-quality JPEG/PNG (others go via canvas).
    const fastPath = rotation === 0 && qualityVal >= 0.92 &&
                     (file.type === 'image/jpeg' || file.type === 'image/png');
    if (fastPath) {
      return { bytes: await file.arrayBuffer(), isJpeg: file.type === 'image/jpeg' };
    }
    return imageViaCanvas(file, rotation, qualityVal);
  }

  function isTiff(file) {
    return file.type === 'image/tiff' || /\.tiff?$/i.test(file.name || '');
  }

  function isHeic(file) {
    return /image\/hei[cf]/.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
  }

  // Lazy <script> loader (used to defer the large heic2any/libheif bundle).
  const loadedScripts = {};
  function loadScript(src) {
    if (loadedScripts[src]) return loadedScripts[src];
    loadedScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`読み込み失敗: ${src}`));
      document.head.appendChild(s);
    });
    return loadedScripts[src];
  }

  // Decode HEIC/HEIF → JPEG Blob via heic2any (lazy-loaded, best-effort, cached).
  const heicCache = new WeakMap();
  async function decodeHeic(file) {
    if (heicCache.has(file)) return heicCache.get(file);
    await loadScript('libs/heic2any.min.js');
    if (typeof heic2any === 'undefined') throw new Error('HEICデコーダを読み込めませんでした');
    let out;
    try {
      out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    } catch (e) {
      throw new Error('このHEICファイルは変換できませんでした。JPEGに変換してからお試しください。');
    }
    const blob = Array.isArray(out) ? out[0] : out;
    heicCache.set(file, blob);
    return blob;
  }

  // Decode a TIFF (first page) to a canvas via UTIF.
  async function tiffToCanvas(file) {
    if (typeof UTIF === 'undefined') throw new Error('TIFFデコーダ未読み込み');
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    if (!ifds.length) throw new Error('TIFFを読み込めませんでした');
    UTIF.decodeImage(buf, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const { width, height } = ifds[0];
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), width, height), 0, 0);
    return canvas;
  }

  // Resolve a file to something drawable on a canvas (HTMLImageElement or canvas).
  // TIFF goes through UTIF; everything else through the native image decoder.
  function loadDrawable(file) {
    if (isHeic(file)) {
      return decodeHeic(file).then(loadDrawable); // decoded JPEG → native path
    }
    if (isTiff(file)) {
      return tiffToCanvas(file).then(c => ({ drawable: c, w: c.width, h: c.height }));
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve({ drawable: img, w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像読み込み失敗')); };
      img.src = url;
    });
  }

  // Decode → (rotate) → re-encode to JPEG/PNG bytes for pdf-lib embedding.
  async function imageViaCanvas(file, rotation, qualityVal) {
    const { drawable, w, h } = await loadDrawable(file);
    const rotated90 = rotation === 90 || rotation === 270;
    const canvas = document.createElement('canvas');
    canvas.width  = rotated90 ? h : w;
    canvas.height = rotated90 ? w : h;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(drawable, -w / 2, -h / 2);
    // PNG keeps transparency; everything else (incl. GIF/BMP/WebP/TIFF) → JPEG.
    const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const q = file.type === 'image/png' ? undefined : qualityVal;
    const blob = await new Promise(res => canvas.toBlob(res, outType, q));
    if (!blob) throw new Error('変換失敗');
    return { bytes: await blob.arrayBuffer(), isJpeg: outType === 'image/jpeg' };
  }

  // Thumbnail data URL for the card grid. TIFF can't be shown via <img> directly.
  async function makeThumbnail(file) {
    if (isHeic(file)) {
      return makeThumbnail(await decodeHeic(file)); // decoded JPEG → FileReader path
    }
    if (isTiff(file)) {
      const c = await tiffToCanvas(file);
      return c.toDataURL('image/jpeg', 0.7);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('読み込み失敗'));
      reader.readAsDataURL(file);
    });
  }

  // ── Download ──
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function downloadPDF(pdfBytes, filename) {
    downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), filename);
  }

  // ── Status ──
  function showStatus(el, type, msg) {
    el.textContent = msg;
    el.className = `status ${type}`;
  }
  function hideStatus(el) {
    el.className = 'status hidden';
  }

  // ── Shared preview modal ──
  const previewModal  = document.getElementById('preview-modal');
  const previewIframe = document.getElementById('preview-iframe');
  const previewSize   = document.getElementById('preview-size');
  const modalClose    = document.getElementById('modal-close');
  const modalOverlay  = document.getElementById('modal-overlay');
  const modalCancel   = document.getElementById('modal-cancel');
  const modalDownload = document.getElementById('modal-download');
  let pendingDownload = null;

  function openPreview(pdfBytes, downloadFn) {
    pendingDownload = downloadFn;
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    previewIframe.src = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (previewSize) previewSize.textContent = `サイズ: ${formatBytes(pdfBytes.length)}`;
    previewModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    previewModal.classList.add('hidden');
    document.body.style.overflow = '';
    previewIframe.src = '';
  }

  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', closeModal);
  modalCancel.addEventListener('click', closeModal);
  modalDownload.addEventListener('click', () => { if (pendingDownload) pendingDownload(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !previewModal.classList.contains('hidden')) closeModal();
  });

  // ── Tool navigation ──
  function showTool(name) {
    document.querySelectorAll('main section[data-tool]').forEach(s => {
      s.classList.toggle('hidden', s.dataset.tool !== name);
    });
    document.querySelectorAll('.tool-nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === name);
    });
  }

  function initNav(defaultTool) {
    document.querySelectorAll('.tool-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => showTool(btn.dataset.tool));
    });
    showTool(defaultTool);
  }

  // Wire up shared init once the DOM is ready (scripts load at end of body).
  initOptionButtons();
  initNav('jpg-to-pdf');

  return {
    PDFDocument,
    MM_TO_PT, PAGE_SIZES, MARGIN_PT, QUALITY_MAP, MAX_FILES, MAX_TOTAL_BYTES,
    formatBytes, getOptions, calcLayout, processImageFile, imageViaCanvas,
    isTiff, isHeic, makeThumbnail, loadScript,
    downloadBlob, downloadPDF, showStatus, hideStatus, openPreview, closeModal,
    showTool,
  };
})();
