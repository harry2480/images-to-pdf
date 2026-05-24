// PDF split: split into individual pages or page ranges via pdf-lib.
(() => {
  const {
    PDFDocument, getOptions, downloadBlob, downloadPDF, formatBytes,
    showStatus, hideStatus,
  } = PdfApp;

  // ── State ──
  let pdfFile = null;
  let pdfDoc = null; // pdf-lib document

  // ── DOM ──
  const root        = document.querySelector('section[data-tool="split-pdf"]');
  const dropZone    = document.getElementById('spl-drop-zone');
  const fileInput   = document.getElementById('spl-file-input');
  const selectBtn   = document.getElementById('spl-select-btn');
  const workspace   = document.getElementById('spl-workspace');
  const infoEl      = document.getElementById('spl-info');
  const rangeGroup  = document.getElementById('spl-range-group');
  const rangeInput  = document.getElementById('spl-range');
  const modeButtons = root.querySelectorAll('.option-buttons[data-opt="mode"] .opt-btn');
  const splitBtn    = document.getElementById('spl-btn');
  const statusEl    = document.getElementById('spl-status');

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
      pdfDoc = await PDFDocument.load(data);
      pdfFile = file;
      const numPages = pdfDoc.getPageCount();
      infoEl.textContent = `${file.name} ・ ${numPages} ページ`;
      rangeInput.value = '';
      dropZone.classList.add('hidden');
      workspace.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `PDFを読み込めませんでした: ${err.message}`);
    }
  }

  // Parse "1-3,5" into a sorted, de-duped, in-range list of 1-based page numbers.
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

  // Toggle range input visibility based on mode
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.value;
      rangeGroup.style.display = mode === 'range' ? 'block' : 'none';
    });
  });

  // ── Split ──
  splitBtn.addEventListener('click', async () => {
    if (!pdfDoc) return;

    const numPages = pdfDoc.getPageCount();
    const opts = getOptions(root);
    const mode = opts.mode || 'all';

    let pages;
    try {
      if (mode === 'all') {
        pages = Array.from({ length: numPages }, (_, i) => i + 1);
      } else {
        pages = parseRange(rangeInput.value, numPages);
      }
    } catch (err) {
      showStatus(statusEl, 'error', err.message);
      return;
    }

    const base = pdfFile.name.replace(/\.[^.]+$/, '');
    splitBtn.disabled = true;
    splitBtn.classList.add('loading');
    splitBtn.textContent = '分割中';
    hideStatus(statusEl);

    try {
      const pad = String(numPages).length;

      if (pages.length === 1) {
        // Single page: extract as single PDF
        const outPdf = await PDFDocument.create();
        const [copied] = await outPdf.copyPages(pdfDoc, [pages[0] - 1]);
        outPdf.addPage(copied);
        const pdfBytes = await outPdf.save();
        downloadPDF(pdfBytes, `${base}-${String(pages[0]).padStart(pad, '0')}.pdf`);
        showStatus(statusEl, 'success', `1ページを抽出しました（${formatBytes(pdfBytes.length)}）`);
      } else {
        // Multiple pages: zip individual PDFs
        const pdfs = []; // { name, bytes }
        for (const p of pages) {
          const outPdf = await PDFDocument.create();
          const [copied] = await outPdf.copyPages(pdfDoc, [p - 1]);
          outPdf.addPage(copied);
          const pdfBytes = await outPdf.save();
          pdfs.push({ name: `${base}-${String(p).padStart(pad, '0')}.pdf`, bytes: pdfBytes });
        }

        // Zip PDFs
        const zipObj = {};
        pdfs.forEach(p => { zipObj[p.name] = p.bytes; });
        const zipped = fflate.zipSync(zipObj, { level: 0 });
        downloadBlob(new Blob([zipped], { type: 'application/zip' }), `${base}_split.zip`);
        showStatus(statusEl, 'success', `${pdfs.length}ページを分割しました（${formatBytes(zipped.length)}）`);
      }
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `エラーが発生しました: ${err.message}`);
    } finally {
      splitBtn.disabled = false;
      splitBtn.classList.remove('loading');
      splitBtn.textContent = '分割する';
    }
  });
})();
