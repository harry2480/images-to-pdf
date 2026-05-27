// PDF Rotation Tool
(() => {
  const { PDFDocument, showStatus, hideStatus,
          showProgress, resetProgress, normalizeAngle } = PdfApp;
  const { degrees } = PDFLib;

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

  // Render Thumbnails — render the whole document with pdf.js ONCE, then slice
  // per page. (Saving/parsing the PDF per page would be O(n²).)
  async function renderPageThumbnails() {
    pagesContainer.innerHTML = '';
    const pageCount = pdfDoc.getPageCount();

    let pdfjsDoc = null;
    try {
      if (typeof pdfjsLib !== 'undefined') {
        const bytes = await pdfDoc.save();
        pdfjsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
      }
    } catch (err) {
      console.warn('Thumbnail document load failed:', err);
      pdfjsDoc = null;
    }

    for (let i = 0; i < pageCount; i++) {
      const pageEl = document.createElement('div');
      pageEl.className = 'rot-page-item';
      pageEl.dataset.pageIndex = i;

      const thumb = pdfjsDoc
        ? await renderThumbnail(pdfjsDoc, i)
        : generatePlaceholderThumbnail(i);
      pageEl.innerHTML = `<img class="rot-page-thumb" src="${thumb}" alt="Page ${i + 1}">
                          <span class="rot-page-num">${i + 1}</span>`;
      pageEl.addEventListener('click', () => selectPage(i));
      pagesContainer.appendChild(pageEl);
    }
  }

  async function renderThumbnail(pdfjsDoc, pageIndex) {
    try {
      const page = await pdfjsDoc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 0.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
      }).promise;
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch (err) {
      console.warn(`Thumbnail render failed for page ${pageIndex + 1}:`, err);
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
    applyThumbTransform(index);
  }

  // Live visual feedback: rotate the thumbnail to match the chosen angle.
  function applyThumbTransform(index) {
    const img = pagesContainer.querySelector(
      `.rot-page-item[data-page-index="${index}"] .rot-page-thumb`
    );
    if (img) {
      const angle = pageRotations[index].angle;
      img.style.transform = angle ? `rotate(${angle}deg)` : '';
    }
  }

  function applyToAllPages(angle) {
    pageRotations.forEach((rot, i) => {
      rot.angle = angle;
      applyThumbTransform(i);
    });
    selectPage(currentPageIndex);
  }

  // Generate Rotated PDF.
  // - Multiples of 90: use the PDF /Rotate entry (lossless, keeps text/links),
  //   added on top of any rotation the source page already has.
  // - Other angles: /Rotate only allows multiples of 90, so embed the page as a
  //   form XObject on a new page sized to the rotated bounding box and draw it
  //   with a rotation matrix.
  async function generateRotatedPdf() {
    const outPdf = await PDFDocument.create();
    const pageCount = pdfDoc.getPageCount();

    for (let i = 0; i < pageCount; i++) {
      const angle = normalizeAngle(pageRotations[i].angle);

      if (angle % 90 === 0) {
        const [copied] = await outPdf.copyPages(pdfDoc, [i]);
        outPdf.addPage(copied);
        if (angle !== 0) {
          const existing = copied.getRotation().angle;
          copied.setRotation(degrees(normalizeAngle(existing + angle)));
        }
      } else {
        const srcPage = pdfDoc.getPage(i);
        const { width: w, height: h } = srcPage.getSize();
        const embedded = await outPdf.embedPage(srcPage);

        const rad = (angle * Math.PI) / 180;
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        // Corners of the page after rotating about the origin.
        const xs = [0, w * c, w * c - h * s, -h * s];
        const ys = [0, w * s, w * s + h * c, h * c];
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        const page = outPdf.addPage([maxX - minX, maxY - minY]);
        // Offset so the rotated content's bounding box sits at the page origin.
        page.drawPage(embedded, {
          x: -minX,
          y: -minY,
          rotate: degrees(angle),
        });
      }

      showProgress(progressEl, ((i + 1) / pageCount) * 100);
    }

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
