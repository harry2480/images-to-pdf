// Watermark: add text or image watermark to PDF
(() => {
  const {
    PDFDocument, MAX_TOTAL_BYTES, getOptions, downloadPDF, formatBytes,
    showStatus, hideStatus,
  } = PdfApp;

  // ── State ──
  let pdfFile = null;
  let pdfDoc = null;
  let watermarkImage = null; // for image watermark

  // ── DOM ──
  const root              = document.querySelector('section[data-tool="watermark"]');
  const dropZone          = document.getElementById('wm-drop-zone');
  const fileInput         = document.getElementById('wm-file-input');
  const selectBtn         = document.getElementById('wm-select-btn');
  const workspace         = document.getElementById('wm-workspace');
  const infoEl            = document.getElementById('wm-info');
  const modeButtons       = root.querySelectorAll('.option-buttons[data-opt="mode"] .opt-btn');
  const textGroup         = document.getElementById('wm-text-group');
  const textInput         = document.getElementById('wm-text');
  const sizeInput         = document.getElementById('wm-size');
  const opacityInput      = document.getElementById('wm-opacity');
  const angleInput        = document.getElementById('wm-angle');
  const colorInput        = document.getElementById('wm-color');
  const imageGroup        = document.getElementById('wm-image-group');
  const imageInput        = document.getElementById('wm-image-file');
  const selectImageBtn    = document.getElementById('wm-select-image-btn');
  const imageSizeInput    = document.getElementById('wm-image-size');
  const imageOpacityInput = document.getElementById('wm-image-opacity');
  const positionButtons   = root.querySelectorAll('.option-buttons[data-opt="position"] .opt-btn');
  const applyBtn          = document.getElementById('wm-btn');
  const statusEl          = document.getElementById('wm-status');

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
    if (file.size > MAX_TOTAL_BYTES) {
      showStatus(statusEl, 'error', `上限（${formatBytes(MAX_TOTAL_BYTES)}）を超えています`);
      return;
    }
    hideStatus(statusEl);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      pdfDoc = await PDFDocument.load(data);
      pdfFile = file;
      const pageCount = pdfDoc.getPageCount();
      infoEl.textContent = `${file.name} ・ ${pageCount} ページ`;
      dropZone.classList.add('hidden');
      workspace.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `PDFを読み込めませんでした: ${err.message}`);
    }
  }

  // ── Mode toggle: text or image ──
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.value;
      textGroup.style.display = mode === 'text' ? 'block' : 'none';
      imageGroup.style.display = mode === 'image' ? 'block' : 'none';
    });
  });

  // ── Image watermark file input ──
  selectImageBtn.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', async e => {
    if (e.target.files[0]) {
      try {
        const file = e.target.files[0];
        const bytes = await file.arrayBuffer();
        watermarkImage = { bytes: new Uint8Array(bytes), type: file.type };
        showStatus(statusEl, 'success', `透かし画像を選択しました: ${file.name}`);
      } catch (err) {
        showStatus(statusEl, 'error', `画像を読み込めませんでした: ${err.message}`);
        watermarkImage = null;
      }
    }
    e.target.value = '';
  });

  // Render text to canvas (for Japanese support)
  async function textToImageBytes(text, size, color) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    ctx.font = `bold ${size}px sans-serif`;
    const metrics = ctx.measureText(text);
    const width = Math.ceil(metrics.width + 40);
    const height = Math.ceil(size + 20);

    canvas.width = width;
    canvas.height = height;

    ctx.font = `bold ${size}px sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);

    return new Promise(resolve => {
      canvas.toBlob(blob => {
        blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
      }, 'image/png');
    });
  }

  // ── Apply watermark ──
  applyBtn.addEventListener('click', async () => {
    if (!pdfDoc) return;

    const opts = getOptions(root);
    const mode = opts.mode || 'text';
    const position = opts.position || 'center';

    applyBtn.disabled = true;
    applyBtn.classList.add('loading');
    applyBtn.textContent = '処理中';
    hideStatus(statusEl);

    try {
      const outPdf = await PDFDocument.create();
      const pageCount = pdfDoc.getPageCount();

      if (mode === 'text') {
        // Text watermark
        const text = textInput.value || 'WATERMARK';
        const size = parseInt(sizeInput.value) || 60;
        const opacity = parseFloat(opacityInput.value) || 0.3;
        const angle = parseInt(angleInput.value) || 45;
        const color = colorInput.value || '#000000';

        try {
          const textBytes = await textToImageBytes(text, size, color);
          const textImg = await outPdf.embedPng(textBytes);

          // Batch all page copies first, then add watermarks
          const copiedPages = [];
          for (let i = 0; i < pageCount; i++) {
            const copied = await outPdf.copyPage(pdfDoc, i);
            outPdf.addPage(copied);
            copiedPages.push(outPdf.getPages()[outPdf.getPageCount() - 1]);
          }

          // Now add watermarks to all pages
          for (const lastPage of copiedPages) {
            const { width, height } = lastPage.getSize();

            let x, y;
            switch (position) {
              case 'center':
                x = width / 2 - (textImg.width / 2);
                y = height / 2 - (textImg.height / 2);
                break;
              case 'bottom-right':
                x = width - textImg.width - 20;
                y = 20;
                break;
              default:
                x = width / 2 - (textImg.width / 2);
                y = height / 2 - (textImg.height / 2);
            }

            lastPage.drawImage(textImg, {
              x, y,
              opacity,
              rotate: angle,
            });
          }

          finalizePdf(outPdf, pageCount);
        } catch (err) {
          throw err;
        }
      } else if (mode === 'image') {
        // Image watermark
        if (!watermarkImage) {
          showStatus(statusEl, 'error', '透かし画像を選択してください');
          applyBtn.disabled = false;
          applyBtn.classList.remove('loading');
          applyBtn.textContent = '透かしを追加';
          return;
        }

        const opacity = parseFloat(imageOpacityInput.value) || 0.3;
        const sizePercent = parseInt(imageSizeInput.value) || 30;

        const imgData = watermarkImage.bytes;
        const imgEmbed = watermarkImage.type === 'image/png'
          ? await outPdf.embedPng(imgData)
          : await outPdf.embedJpg(imgData);

        const { width: imgW, height: imgH } = imgEmbed;
        const ratio = imgW / imgH;

        // Batch all page copies first
        const copiedPages = [];
        for (let i = 0; i < pageCount; i++) {
          const copied = await outPdf.copyPage(pdfDoc, i);
          outPdf.addPage(copied);
          copiedPages.push(outPdf.getPages()[outPdf.getPageCount() - 1]);
        }

        // Now add watermarks to all pages
        for (const lastPage of copiedPages) {
          const { width, height } = lastPage.getSize();

          const wmWidth = (width * sizePercent) / 100;
          const wmHeight = wmWidth / ratio;

          let x, y;
          switch (position) {
            case 'center':
              x = (width - wmWidth) / 2;
              y = (height - wmHeight) / 2;
              break;
            case 'bottom-right':
              x = width - wmWidth - 20;
              y = 20;
              break;
            default:
              x = (width - wmWidth) / 2;
              y = (height - wmHeight) / 2;
          }

          lastPage.drawImage(imgEmbed, {
            x, y,
            width: wmWidth,
            height: wmHeight,
            opacity,
          });
        }

        finalizePdf(outPdf, pageCount);
      }
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `エラーが発生しました: ${err.message}`);
      applyBtn.disabled = false;
      applyBtn.classList.remove('loading');
      applyBtn.textContent = '透かしを追加';
    }
  });

  function finalizePdf(outPdf, pageCount) {
    outPdf.save().then(pdfBytes => {
      const base = pdfFile.name.replace(/\.[^.]+$/, '');
      downloadPDF(pdfBytes, `${base}_watermarked.pdf`);
      showStatus(statusEl, 'success', `${pageCount}ページに透かしを追加しました（${formatBytes(pdfBytes.length)}）`);
      applyBtn.disabled = false;
      applyBtn.classList.remove('loading');
      applyBtn.textContent = '透かしを追加';
    }).catch(err => {
      console.error(err);
      showStatus(statusEl, 'error', `PDF保存エラー: ${err.message}`);
      applyBtn.disabled = false;
      applyBtn.classList.remove('loading');
      applyBtn.textContent = '透かしを追加';
    });
  }
})();
