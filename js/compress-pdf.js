// PDF compression for image/scanned PDFs: rasterize each page via pdf.js and
// re-embed as JPEG via pdf-lib. NOTE: this discards text/vector content — it is
// only useful for image-based PDFs. Text PDFs are warned about (and may grow).
(() => {
  const {
    PDFDocument, getOptions, downloadPDF, formatBytes,
    showStatus, hideStatus, showProgress, resetProgress,
  } = PdfApp;

  // scale = render DPI factor, q = JPEG quality
  const LEVELS = {
    strong: { scale: 1.0, q: 0.40 },
    medium: { scale: 1.3, q: 0.55 },
    light:  { scale: 1.6, q: 0.72 },
  };

  let pdfFile = null;
  let pdfDoc = null;     // pdf.js document
  let originalSize = 0;

  const root       = document.querySelector('section[data-tool="compress-pdf"]');
  const dropZone   = document.getElementById('cmp-drop-zone');
  const fileInput  = document.getElementById('cmp-file-input');
  const selectBtn  = document.getElementById('cmp-select-btn');
  const workspace  = document.getElementById('cmp-workspace');
  const infoEl     = document.getElementById('cmp-info');
  const warningEl  = document.getElementById('cmp-warning');
  const compressBtn= document.getElementById('cmp-btn');
  const statusEl   = document.getElementById('cmp-status');
  const progressEl = document.getElementById('cmp-progress');

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
    if (!isPdf(file)) { showStatus(statusEl, 'error', 'PDFファイルを選択してください'); return; }
    hideStatus(statusEl);
    warningEl.classList.add('hidden');
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      pdfDoc = await pdfjsLib.getDocument({ data }).promise;
      pdfFile = file;
      originalSize = file.size;
      infoEl.textContent = `${file.name} ・ ${pdfDoc.numPages} ページ ・ 元サイズ ${formatBytes(originalSize)}`;
      dropZone.classList.add('hidden');
      workspace.classList.remove('hidden');
      await maybeWarnTextPdf();
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `PDFを読み込めませんでした: ${err.message}`);
    }
  }

  // Sample the first few pages; if there's substantial text, warn that
  // rasterizing will lose it.
  async function maybeWarnTextPdf() {
    try {
      let chars = 0;
      const n = Math.min(pdfDoc.numPages, 5);
      for (let p = 1; p <= n; p++) {
        const tc = await (await pdfDoc.getPage(p)).getTextContent();
        chars += tc.items.reduce((s, it) => s + (it.str ? it.str.length : 0), 0);
      }
      if (chars > 200) {
        warningEl.textContent = 'このPDFはテキストを多く含みます。圧縮すると文字情報が失われ、画像化されます（テキスト主体のPDFには不向きです）。';
        warningEl.classList.remove('hidden');
      }
    } catch (_) { /* text probe is best-effort */ }
  }

  async function renderPageAsJpeg(pageNum, scale, q) {
    const page = await pdfDoc.getPage(pageNum);
    const vp1 = page.getViewport({ scale: 1 });        // points (1px = 1pt at scale 1)
    const vp  = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
    if (!blob) throw new Error('ページの画像化に失敗しました');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), w: vp1.width, h: vp1.height };
  }

  compressBtn.addEventListener('click', async () => {
    if (!pdfDoc) return;
    const { scale, q } = LEVELS[getOptions(root).level] || LEVELS.medium;

    compressBtn.disabled = true;
    compressBtn.classList.add('loading');
    compressBtn.textContent = '圧縮中';
    hideStatus(statusEl);
    resetProgress(progressEl);

    try {
      const out = await PDFDocument.create();
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        const { bytes, w, h } = await renderPageAsJpeg(p, scale, q);
        const img = await out.embedJpg(bytes);
        const page = out.addPage([w, h]);
        page.drawImage(img, { x: 0, y: 0, width: w, height: h });
        showProgress(progressEl, (p / pdfDoc.numPages) * 100);
      }
      const result = await out.save();
      const newSize = result.length;
      const ratio = Math.round((1 - newSize / originalSize) * 100);

      const base = pdfFile.name.replace(/\.[^.]+$/, '');
      downloadPDF(result, `${base}_compressed.pdf`);

      if (newSize >= originalSize) {
        showStatus(statusEl, 'error',
          `圧縮後の方が大きくなりました（${formatBytes(originalSize)} → ${formatBytes(newSize)}）。このPDFは圧縮に不向きです。`);
      } else {
        showStatus(statusEl, 'success',
          `圧縮しました：${formatBytes(originalSize)} → ${formatBytes(newSize)}（${ratio}% 削減）`);
      }
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `エラーが発生しました: ${err.message}`);
    } finally {
      compressBtn.disabled = false;
      compressBtn.classList.remove('loading');
      compressBtn.textContent = '圧縮する';
      resetProgress(progressEl);
    }
  });
})();
