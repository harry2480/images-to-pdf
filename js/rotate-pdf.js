// PDF Rotation Tool
(() => {
  const { PDFDocument, downloadPDF, showStatus, hideStatus,
          showProgress, resetProgress, normalizeAngle, rotatePdfPage } = PdfApp;

  // State
  let pdfFile = null;
  let pdfDoc = null;
  let pageRotations = []; // [{ pageIndex, angle }, ...]
  let currentPageIndex = 0;

  // DOM Elements
  const root = document.querySelector('section[data-tool="rotate-pdf"]');
  const dropZone = document.getElementById('rot-drop-zone');
  const fileInput = document.getElementById('rot-file-input');
  const selectBtn = document.getElementById('rot-select-btn');
  const workspace = document.getElementById('rot-workspace');
  const pagesContainer = document.getElementById('rot-pages');

  const rotBtnLeft = document.getElementById('rot-btn-left');
  const rotBtnRight = document.getElementById('rot-btn-right');
  const rotSlider = document.getElementById('rot-slider');
  const rotAngleInput = document.getElementById('rot-angle-input');
  const rotApplyAll = document.getElementById('rot-apply-all');

  const previewBtn = document.getElementById('rot-preview-btn');
  const convertBtn = document.getElementById('rot-convert-btn');
  const statusEl = document.getElementById('rot-status');
  const progressEl = document.getElementById('rot-progress');
  const infoEl = document.getElementById('rot-info');

  // File Input Handler
  selectBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      loadPdf(e.target.files[0]);
    }
    e.target.value = '';
  });

  // Drag and Drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = Array.from(e.dataTransfer.files).find(f => f.type === 'application/pdf');
    if (f) {
      loadPdf(f);
    }
  });

  // Load PDF
  async function loadPdf(file) {
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      pdfDoc = await PDFDocument.load(data);
      pdfFile = file;
      const pageCount = pdfDoc.getPageCount();

      // Initialize rotation array
      pageRotations = Array.from({ length: pageCount }, (_, i) => ({
        pageIndex: i,
        angle: 0,
      }));

      infoEl.textContent = `${file.name} ・ ${pageCount} ページ`;
      await renderPageThumbnails();

      dropZone.classList.add('hidden');
      workspace.classList.remove('hidden');
      selectPage(0);
      hideStatus(statusEl);
    } catch (err) {
      showStatus(statusEl, 'error', `読み込み失敗: ${err.message}`);
    }
  }

  // Render Thumbnails
  async function renderPageThumbnails() {
    pagesContainer.innerHTML = '';
    for (let i = 0; i < pdfDoc.getPageCount(); i++) {
      const pageEl = document.createElement('div');
      pageEl.className = 'rot-page-item';
      pageEl.dataset.pageIndex = i;

      const thumb = await generateThumbnail(i);
      pageEl.innerHTML = `<img class="rot-page-thumb" src="${thumb}" alt="Page ${i + 1}">
                          <span class="rot-page-num">${i + 1}</span>`;
      pageEl.addEventListener('click', () => selectPage(i));
      pagesContainer.appendChild(pageEl);
    }
  }

  // Generate Thumbnail using pdf.js
  async function generateThumbnail(pageIndex) {
    try {
      if (typeof pdfjsLib === 'undefined') {
        return generatePlaceholderThumbnail(pageIndex);
      }

      const pdfBytes = await pdfDoc.save();
      const pdf = await pdfjsLib.getDocument(pdfBytes).promise;
      const page = await pdf.getPage(pageIndex + 1);

      const scale = 1;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: viewport,
      }).promise;

      return canvas.toDataURL('image/jpeg', 0.7);
    } catch (err) {
      console.warn(`Thumbnail generation failed for page ${pageIndex + 1}:`, err);
      return generatePlaceholderThumbnail(pageIndex);
    }
  }

  // Generate Placeholder Thumbnail (SVG)
  function generatePlaceholderThumbnail(pageIndex) {
    return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 160'%3E%3Crect width='120' height='160' fill='%23f0f0f0'/%3E%3Ctext x='50%25' y='50%25' font-size='14' text-anchor='middle' dy='.3em' fill='%23999'%3E${pageIndex + 1}%3C/text%3E%3C/svg%3E`;
  }

  // Select Page
  function selectPage(index) {
    currentPageIndex = index;
    document.querySelectorAll('.rot-page-item').forEach((el, i) => {
      el.classList.toggle('active', i === index);
    });

    const rotation = pageRotations[index].angle;
    rotSlider.value = rotation;
    rotAngleInput.value = rotation;
  }

  // Rotation Controls
  rotBtnLeft.addEventListener('click', () => rotateCurrentPage(-90));
  rotBtnRight.addEventListener('click', () => rotateCurrentPage(90));
  rotSlider.addEventListener('input', (e) => {
    const angle = parseInt(e.target.value);
    rotAngleInput.value = angle;
    updatePageRotation(currentPageIndex, angle);
  });
  rotAngleInput.addEventListener('change', (e) => {
    const angle = parseInt(e.target.value) || 0;
    rotSlider.value = angle;
    updatePageRotation(currentPageIndex, angle);
  });
  rotApplyAll.addEventListener('click', () => {
    applyToAllPages(pageRotations[currentPageIndex].angle);
  });

  function rotateCurrentPage(delta) {
    const current = pageRotations[currentPageIndex].angle;
    const newAngle = current + delta;
    updatePageRotation(currentPageIndex, newAngle);
    rotSlider.value = newAngle;
    rotAngleInput.value = newAngle;
  }

  function updatePageRotation(index, angle) {
    pageRotations[index].angle = angle;
  }

  function applyToAllPages(angle) {
    pageRotations.forEach((rot) => {
      rot.angle = angle;
    });
    selectPage(currentPageIndex);
  }

  // Generate Rotated PDF
  async function generateRotatedPdf() {
    const outPdf = await PDFDocument.create();
    const indices = Array.from({ length: pdfDoc.getPageCount() }, (_, i) => i);
    const pages = await outPdf.copyPages(pdfDoc, indices);

    pages.forEach((page, i) => {
      outPdf.addPage(page);
      const angle = pageRotations[i].angle;
      if (angle !== 0) {
        rotatePdfPage(page, angle);
      }
    });

    return await outPdf.save();
  }

  // Preview
  previewBtn.addEventListener('click', async () => {
    try {
      showProgress(progressEl, 0);
      const bytes = await generateRotatedPdf();
      showProgress(progressEl, 100);
      setTimeout(() => resetProgress(progressEl), 500);
      PdfApp.openPreview(bytes, () => downloadRotatedPdf(bytes));
    } catch (err) {
      showStatus(statusEl, 'error', `プレビュー失敗: ${err.message}`);
    }
  });

  // Download
  convertBtn.addEventListener('click', async () => {
    try {
      convertBtn.disabled = true;
      showProgress(progressEl, 0);
      const bytes = await generateRotatedPdf();
      showProgress(progressEl, 100);
      downloadRotatedPdf(bytes);
      showStatus(statusEl, 'success', `完了: ${pdfFile.name} を回転して保存しました`);
    } catch (err) {
      showStatus(statusEl, 'error', `変換失敗: ${err.message}`);
    } finally {
      convertBtn.disabled = false;
    }
  });

  function downloadRotatedPdf(bytes) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rotated-${pdfFile.name}`;
    a.click();
    URL.revokeObjectURL(url);
  }
})();
