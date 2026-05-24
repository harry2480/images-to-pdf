// PDF → images (one per page) via pdf.js. Multi-page output is zipped with fflate.
(() => {
  const {
    getOptions, downloadBlob, formatBytes,
    showStatus, hideStatus, showProgress, resetProgress,
  } = PdfApp;

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
  }

  // ── State ──
  let pdfFile = null;
  let pdfDoc = null; // pdf.js document proxy

  // ── DOM ──
  const root       = document.querySelector('section[data-tool="pdf-to-jpg"]');
  const dropZone   = document.getElementById('p2j-drop-zone');
  const fileInput  = document.getElementById('p2j-file-input');
  const selectBtn  = document.getElementById('p2j-select-btn');
  const workspace  = document.getElementById('p2j-workspace');
  const infoEl     = document.getElementById('p2j-info');
  const rangeInput = document.getElementById('p2j-range');
  const convertBtn = document.getElementById('p2j-convert');
  const statusEl   = document.getElementById('p2j-status');
  const progressEl = document.getElementById('p2j-progress');

  // ── File input / drag-drop ──
  selectBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadPdf(e.target.files[0]);
    e.target.value = '';
  });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = Array.from(e.dataTransfer.files).find(isPdf);
    if (f) loadPdf(f);
  });

  function isPdf(f) {
    return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  }

  async function loadPdf(file) {
    if (!isPdf(file)) {
      showStatus(statusEl, 'error', 'PDFファイルを選択してください');
      return;
    }
    hideStatus(statusEl);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      pdfDoc = await pdfjsLib.getDocument({ data }).promise;
      pdfFile = file;
      infoEl.textContent = `${file.name} ・ ${pdfDoc.numPages} ページ`;
      rangeInput.value = '';
      dropZone.classList.add('hidden');
      workspace.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `PDFを読み込めませんでした: ${err.message}`);
    }
  }

  // Parse "1-3,5" into a sorted, de-duped, in-range list of 1-based page numbers.
  // Empty → all pages.
  function parseRange(str, numPages) {
    const trimmed = (str || '').trim();
    if (!trimmed) return Array.from({ length: numPages }, (_, i) => i + 1);
    const set = new Set();
    for (const part of trimmed.split(',')) {
      const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) throw new Error(`ページ範囲の形式が不正です: "${part.trim()}"`);
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      for (let p = lo; p <= hi; p++) {
        if (p >= 1 && p <= numPages) set.add(p);
      }
    }
    if (set.size === 0) throw new Error('有効なページがありません');
    return Array.from(set).sort((x, y) => x - y);
  }

  async function renderPage(pageNum, scale, type, quality) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    // White backdrop so transparent regions don't go black in JPEG.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, type, quality));
    if (!blob) throw new Error('画像化に失敗しました');
    return new Uint8Array(await blob.arrayBuffer());
  }

  // ── Convert ──
  convertBtn.addEventListener('click', async () => {
    if (!pdfDoc) return;

    let pages;
    try {
      pages = parseRange(rangeInput.value, pdfDoc.numPages);
    } catch (err) {
      showStatus(statusEl, 'error', err.message);
      return;
    }

    const opts = getOptions(root);
    const scale = parseFloat(opts.scale) || 1.5;
    const type = opts.format === 'png' ? 'image/png' : 'image/jpeg';
    const ext = opts.format === 'png' ? 'png' : 'jpg';
    const quality = type === 'image/jpeg' ? 0.92 : undefined;
    const base = pdfFile.name.replace(/\.[^.]+$/, '');

    convertBtn.disabled = true;
    convertBtn.classList.add('loading');
    convertBtn.textContent = '変換中';
    hideStatus(statusEl);
    resetProgress(progressEl);

    try {
      const pad = String(pdfDoc.numPages).length;
      const images = []; // { name, bytes }
      let i = 0;
      for (const p of pages) {
        const bytes = await renderPage(p, scale, type, quality);
        images.push({ name: `${base}-${String(p).padStart(pad, '0')}.${ext}`, bytes });
        i++;
        showProgress(progressEl, (i / pages.length) * 100);
      }

      if (images.length === 1) {
        downloadBlob(new Blob([images[0].bytes], { type }), images[0].name);
        showStatus(statusEl, 'success', `1ページを変換しました（${formatBytes(images[0].bytes.length)}）`);
      } else {
        const zipObj = {};
        images.forEach(im => { zipObj[im.name] = im.bytes; });
        // Images are already compressed → store (level 0) to keep zipping fast.
        const zipped = fflate.zipSync(zipObj, { level: 0 });
        downloadBlob(new Blob([zipped], { type: 'application/zip' }), `${base}_images.zip`);
        showStatus(statusEl, 'success', `${images.length}ページをZIPに変換しました（${formatBytes(zipped.length)}）`);
      }
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `エラーが発生しました: ${err.message}`);
    } finally {
      convertBtn.disabled = false;
      convertBtn.classList.remove('loading');
      convertBtn.textContent = '画像に変換';
      resetProgress(progressEl);
    }
  });
})();
