// OCR: extract text from PDF or image using Tesseract.js
(() => {
  const {
    MAX_TOTAL_BYTES, getOptions, downloadBlob, formatBytes,
    showStatus, hideStatus, loadScript,
  } = PdfApp;

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
  }

  // ── State ──
  let fileData = null; // { file, type: 'pdf'|'image' }
  let pdfDoc = null; // pdf.js document (if PDF)
  let Tesseract = null; // lazy-loaded

  // ── DOM ──
  const root           = document.querySelector('section[data-tool="ocr"]');
  const dropZone       = document.getElementById('ocr-drop-zone');
  const fileInput      = document.getElementById('ocr-file-input');
  const selectBtn      = document.getElementById('ocr-select-btn');
  const workspace      = document.getElementById('ocr-workspace');
  const infoEl         = document.getElementById('ocr-info');
  const langButtons    = root.querySelectorAll('.option-buttons[data-opt="lang"] .opt-btn');
  const pageGroup      = document.getElementById('ocr-page-group');
  const pageInput      = document.getElementById('ocr-page');
  const extractBtn     = document.getElementById('ocr-btn');
  const statusEl       = document.getElementById('ocr-status');
  const resultArea     = document.getElementById('ocr-result');
  const copyBtn        = document.getElementById('ocr-copy-btn');

  // ── File input / drag-drop ──
  selectBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
    e.target.value = '';
  });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = Array.from(e.dataTransfer.files).find(isSupported);
    if (f) loadFile(f);
  });

  function isSupported(f) {
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    const isImage = /^image\/(jpeg|png|webp|gif|bmp|tiff)$/i.test(f.type) ||
                    /\.(jpg|jpeg|png|webp|gif|bmp|tif|tiff)$/i.test(f.name);
    return isPdf || isImage;
  }

  async function loadFile(file) {
    if (!isSupported(file)) {
      showStatus(statusEl, 'error', 'PDF または画像ファイルを選択してください');
      return;
    }
    if (file.size > MAX_TOTAL_BYTES) {
      showStatus(statusEl, 'error', `上限（${formatBytes(MAX_TOTAL_BYTES)}）を超えています`);
      return;
    }
    hideStatus(statusEl);
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      fileData = { file, type: isPdf ? 'pdf' : 'image' };

      if (isPdf) {
        const data = new Uint8Array(await file.arrayBuffer());
        pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        infoEl.textContent = `${file.name} ・ ${pdfDoc.numPages} ページ`;
        pageGroup.style.display = 'block';
      } else {
        infoEl.textContent = `${file.name}`;
        pageGroup.style.display = 'none';
      }

      resultArea.value = '';
      dropZone.classList.add('hidden');
      workspace.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `ファイルを読み込めませんでした: ${err.message}`);
    }
  }

  // Parse page range similar to pdf-to-jpg.js
  function parsePageRange(str, numPages) {
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

  // Render PDF page to canvas
  async function renderPageToCanvas(pageNum, scale = 2) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  }

  // Load Tesseract.js if not already loaded
  async function ensureTesseract() {
    if (Tesseract) return Tesseract;
    try {
      showStatus(statusEl, 'info', 'Tesseract.js を読み込み中...');
      await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.0.0/dist/tesseract.min.js');
      Tesseract = window.Tesseract;
      if (!Tesseract) throw new Error('Tesseract.js の読み込みに失敗しました');
      hideStatus(statusEl);
      return Tesseract;
    } catch (err) {
      showStatus(statusEl, 'error', `Tesseract.js 読み込みエラー: ${err.message}`);
      throw err;
    }
  }

  // Extract text using Tesseract
  async function extractPageText(imageOrCanvas, lang) {
    const Tess = await ensureTesseract();
    const { data: { text } } = await Tess.recognize(imageOrCanvas, lang, {
      logger: m => {
        if (m.status === 'recognizing') {
          const pct = Math.round(m.progress * 100);
          showStatus(statusEl, 'info', `処理中... ${pct}%`);
        }
      },
    });
    return text;
  }

  // ── Extract ──
  extractBtn.addEventListener('click', async () => {
    if (!fileData) return;

    const opts = getOptions(root);
    const lang = opts.lang || 'jpn';

    let pages = [];
    if (fileData.type === 'pdf') {
      try {
        pages = parsePageRange(pageInput.value, pdfDoc.numPages);
      } catch (err) {
        showStatus(statusEl, 'error', err.message);
        return;
      }
    } else {
      pages = [1];
    }

    extractBtn.disabled = true;
    extractBtn.classList.add('loading');
    extractBtn.textContent = '抽出中';
    resultArea.value = '';
    hideStatus(statusEl);

    try {
      const results = [];

      if (fileData.type === 'pdf') {
        for (const p of pages) {
          const canvas = await renderPageToCanvas(p);
          const text = await extractPageText(canvas, lang);
          results.push(`--- ページ ${p} ---\n${text}`);
        }
      } else {
        // Image: load as <img> and extract
        const blob = fileData.file;
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.src = url;
        await new Promise(r => { img.onload = r; });
        const text = await extractPageText(img, lang);
        results.push(text);
        URL.revokeObjectURL(url);
      }

      const fullText = results.join('\n\n');
      resultArea.value = fullText;
      showStatus(statusEl, 'success', `${results.length} ページ分のテキストを抽出しました`);
      copyBtn.style.display = 'inline-block';
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `エラーが発生しました: ${err.message}`);
    } finally {
      extractBtn.disabled = false;
      extractBtn.classList.remove('loading');
      extractBtn.textContent = 'テキスト抽出';
    }
  });

  // Copy result to clipboard
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(resultArea.value);
      showStatus(statusEl, 'success', 'クリップボードにコピーしました');
    } catch (err) {
      showStatus(statusEl, 'error', `コピーに失敗しました: ${err.message}`);
    }
  });
})();
