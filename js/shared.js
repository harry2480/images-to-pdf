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

  function imageViaCanvas(file, rotation, qualityVal) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const rotated90 = rotation === 90 || rotation === 270;
        const canvas = document.createElement('canvas');
        canvas.width  = rotated90 ? img.naturalHeight : img.naturalWidth;
        canvas.height = rotated90 ? img.naturalWidth  : img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        URL.revokeObjectURL(url);
        // PNG keeps transparency; everything else (incl. GIF/BMP/WebP) → JPEG.
        const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const q = file.type === 'image/png' ? undefined : qualityVal;
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('変換失敗')); return; }
          blob.arrayBuffer()
            .then(bytes => resolve({ bytes, isJpeg: outType === 'image/jpeg' }))
            .catch(reject);
        }, outType, q);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像読み込み失敗')); };
      img.src = url;
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
    downloadBlob, downloadPDF, showStatus, hideStatus, openPreview, closeModal,
    showTool,
  };
})();
