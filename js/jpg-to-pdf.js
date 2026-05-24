// JPG/PNG/WebP/GIF/BMP → single PDF.
(() => {
  const {
    PDFDocument, MARGIN_PT, QUALITY_MAP, MAX_FILES, MAX_TOTAL_BYTES,
    calcLayout, processImageFile, getOptions, downloadPDF, formatBytes,
    showStatus, hideStatus, showProgress, resetProgress, openPreview, isTiff, isHeic, makeThumbnail, openCropEditor,
  } = PdfApp;
  const { StandardFonts, rgb } = PDFLib;

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
  function isAllowed(file) {
    // TIFF/HEIC often report empty MIME → also accept by extension.
    return ALLOWED.includes(file.type) || isTiff(file) || isHeic(file);
  }

  // ── State ──
  let files = []; // { id, file, rotation }
  let nextId = 0;
  let lastPdfBytes = null;
  let lastOrderedFiles = null;

  // ── DOM ──
  const root        = document.querySelector('section[data-tool="jpg-to-pdf"]');
  const dropZone    = document.getElementById('drop-zone');
  const fileInput   = document.getElementById('file-input');
  const selectBtn   = document.getElementById('select-btn');
  const workspace   = document.getElementById('workspace');
  const fileList    = document.getElementById('file-list');
  const addMoreBtn  = document.getElementById('add-more-btn');
  const convertBtn  = document.getElementById('convert-btn');
  const previewBtn  = document.getElementById('preview-btn');
  const statusEl    = document.getElementById('status');
  const progressEl  = document.getElementById('progress');

  // batch toolbar
  const batchRotate  = document.getElementById('batch-rotate');
  const batchName    = document.getElementById('batch-name');
  const batchDate    = document.getElementById('batch-date');
  const batchReverse = document.getElementById('batch-reverse');
  const batchClear   = document.getElementById('batch-clear');

  // ── SortableJS ──
  Sortable.create(fileList, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: updateNumbers,
  });

  // ── File input / drag-drop ──
  selectBtn.addEventListener('click', () => fileInput.click());
  addMoreBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    addFiles(e.target.files);
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
    addFiles(e.dataTransfer.files);
  });

  // ── Batch toolbar ──
  batchRotate.addEventListener('click', () => rotateAll(90));
  batchName.addEventListener('click', () => sortBy((a, b) => a.file.name.localeCompare(b.file.name, 'ja', { numeric: true })));
  batchDate.addEventListener('click', () => sortBy((a, b) => a.file.lastModified - b.file.lastModified));
  batchReverse.addEventListener('click', reverseOrder);
  batchClear.addEventListener('click', clearAll);

  // ── Add files ──
  function addFiles(fileList_) {
    const incoming = Array.from(fileList_).filter(isAllowed);
    let total = files.reduce((s, e) => s + e.file.size, 0);
    let skipped = 0;

    for (const file of incoming) {
      if (files.length >= MAX_FILES) { skipped++; continue; }
      if (total + file.size > MAX_TOTAL_BYTES) { skipped++; continue; }
      const id = nextId++;
      files.push({ id, file, rotation: 0 });
      renderCard({ id, file, rotation: 0 });
      total += file.size;
    }

    if (files.length > 0) showWorkspace();
    updateNumbers();
    if (incoming.some(isHeic)) {
      showStatus(statusEl, 'success', 'HEIC を変換中です…（初回は読み込みに時間がかかります）');
      setTimeout(() => { if (statusEl.textContent.startsWith('HEIC')) hideStatus(statusEl); }, 6000);
    }
    if (skipped > 0) {
      showStatus(statusEl, 'error',
        `上限（${MAX_FILES}枚 / ${formatBytes(MAX_TOTAL_BYTES)}）を超えるため ${skipped} 件を追加できませんでした`);
    }
  }

  function showWorkspace() {
    dropZone.classList.add('hidden');
    workspace.classList.remove('hidden');
  }

  // ── Render card ──
  function renderCard({ id, file, rotation }) {
    const card = document.createElement('div');
    card.className = 'file-card';
    card.dataset.id = id;

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'file-card-thumb-wrap';

    const live = files.find(f => f.id === id);
    const thumbSrc = (live && live.editedBlob) || file;
    if (live && live.editedBlob) card.classList.add('edited');

    const thumb = document.createElement('img');
    thumb.className = 'file-card-thumb';
    thumb.alt = file.name;
    if (rotation) thumb.style.transform = `rotate(${rotation}deg)`;
    makeThumbnail(thumbSrc).then(url => { thumb.src = url; }).catch(() => {});
    thumbWrap.appendChild(thumb);

    const num = document.createElement('span');
    num.className = 'file-card-num';

    const del = document.createElement('button');
    del.className = 'file-card-delete';
    del.title = '削除';
    del.textContent = '×';
    del.addEventListener('click', e => { e.stopPropagation(); removeFile(id, card); });

    const footer = document.createElement('div');
    footer.className = 'file-card-footer';

    const name = document.createElement('div');
    name.className = 'file-card-name';
    name.textContent = file.name; // textContent: never inject filename as HTML
    name.title = file.name;

    const actions = document.createElement('div');
    actions.className = 'file-card-actions';

    const rotL = document.createElement('button');
    rotL.className = 'btn-rotate';
    rotL.title = '左に回転';
    rotL.textContent = '↺';
    rotL.addEventListener('click', e => { e.stopPropagation(); rotateCard(id, -90); });

    const rotR = document.createElement('button');
    rotR.className = 'btn-rotate';
    rotR.title = '右に回転';
    rotR.textContent = '↻';
    rotR.addEventListener('click', e => { e.stopPropagation(); rotateCard(id, 90); });

    const cropBtn = document.createElement('button');
    cropBtn.className = 'btn-rotate';
    cropBtn.title = '編集（クロップ）';
    cropBtn.textContent = '✂';
    cropBtn.addEventListener('click', e => {
      e.stopPropagation();
      const entry = files.find(f => f.id === id);
      if (!entry) return;
      openCropEditor(entry.editedBlob || entry.file, blob => {
        entry.editedBlob = blob;
        makeThumbnail(blob).then(u => { thumb.src = u; }).catch(() => {});
        card.classList.add('edited');
      });
    });

    actions.appendChild(rotL);
    actions.appendChild(rotR);
    actions.appendChild(cropBtn);
    footer.appendChild(name);
    footer.appendChild(actions);

    card.appendChild(thumbWrap);
    card.appendChild(num);
    card.appendChild(del);
    card.appendChild(footer);
    fileList.appendChild(card);
  }

  function rotateCard(id, delta) {
    const entry = files.find(f => f.id === id);
    if (!entry) return;
    entry.rotation = ((entry.rotation + delta) % 360 + 360) % 360;
    const thumb = fileList.querySelector(`[data-id="${id}"] .file-card-thumb`);
    if (thumb) thumb.style.transform = entry.rotation ? `rotate(${entry.rotation}deg)` : '';
  }

  function removeFile(id, card) {
    files = files.filter(f => f.id !== id);
    card.remove();
    updateNumbers();
    if (files.length === 0) resetToDropZone();
  }

  function resetToDropZone() {
    workspace.classList.add('hidden');
    dropZone.classList.remove('hidden');
    hideStatus(statusEl);
  }

  function updateNumbers() {
    fileList.querySelectorAll('.file-card').forEach((card, i) => {
      card.querySelector('.file-card-num').textContent = i + 1;
    });
  }

  // ── Batch operations ──
  function rotateAll(delta) {
    files.forEach(f => rotateCard(f.id, delta));
  }

  // Re-render the DOM list in a new order (getOrderedFiles reads DOM order).
  function rerender(orderedEntries) {
    fileList.innerHTML = '';
    orderedEntries.forEach(renderCard);
    updateNumbers();
  }

  function sortBy(cmp) {
    const ordered = getOrderedFiles().slice().sort(cmp);
    files = ordered;
    rerender(ordered);
  }

  function reverseOrder() {
    const ordered = getOrderedFiles().slice().reverse();
    files = ordered;
    rerender(ordered);
  }

  function clearAll() {
    files = [];
    fileList.innerHTML = '';
    resetToDropZone();
  }

  function getOrderedFiles() {
    return Array.from(fileList.querySelectorAll('.file-card'))
      .map(card => files.find(f => f.id === parseInt(card.dataset.id, 10)))
      .filter(Boolean);
  }

  // ── PDF generation ──
  async function generatePDF(fileEntries, options, progressEl) {
    const pdfDoc     = await PDFDocument.create();
    const marginPt   = MARGIN_PT[options.margin]   ?? 0;
    const qualityVal = QUALITY_MAP[options.quality] ?? 0.92;
    const wantNumber = options.pageNumber && options.pageNumber !== 'none';
    const font = wantNumber ? await pdfDoc.embedFont(StandardFonts.Helvetica) : null;

    let i = 0;
    for (const entry of fileEntries) {
      const source = entry.editedBlob || entry.file;
      const { bytes, isJpeg } = await processImageFile({ file: source, rotation: entry.rotation }, qualityVal);
      const image = isJpeg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);

      const layout = calcLayout(image, options, marginPt);
      const page = pdfDoc.addPage([layout.width, layout.height]);
      page.drawImage(image, {
        x: layout.x ?? marginPt,
        y: layout.y ?? marginPt,
        width: layout.imgW,
        height: layout.imgH,
      });

      if (wantNumber) {
        const label = String(i + 1);
        const size = 11;
        const textW = font.widthOfTextAtSize(label, size);
        const x = options.pageNumber === 'center' ? (layout.width - textW) / 2 : layout.width - textW - 18;
        page.drawText(label, { x, y: 14, size, font, color: rgb(0.4, 0.4, 0.4) });
      }
      i++;
      if (progressEl) showProgress(progressEl, (i / fileEntries.length) * 100);
    }

    return pdfDoc.save();
  }

  function generateFilename(orderedFiles) {
    if (!orderedFiles || orderedFiles.length === 0) return 'converted.pdf';
    const first = orderedFiles[0].file.name.replace(/\.[^.]+$/, '');
    if (orderedFiles.length === 1) return `${first}.pdf`;
    return `${first}_and_${orderedFiles.length - 1}_more.pdf`;
  }

  // ── Preview ──
  previewBtn.addEventListener('click', async () => {
    const ordered = getOrderedFiles();
    if (ordered.length === 0) return;

    previewBtn.disabled = true;
    previewBtn.classList.add('loading');
    previewBtn.textContent = '生成中';
    hideStatus(statusEl);
    resetProgress(progressEl);

    try {
      const pdfBytes = await generatePDF(ordered, getOptions(root), progressEl);
      lastPdfBytes = pdfBytes;
      lastOrderedFiles = ordered;
      openPreview(pdfBytes, () => downloadPDF(lastPdfBytes, generateFilename(lastOrderedFiles)));
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `エラーが発生しました: ${err.message}`);
    } finally {
      previewBtn.disabled = false;
      previewBtn.classList.remove('loading');
      previewBtn.textContent = 'プレビュー';
      resetProgress(progressEl);
    }
  });

  // ── Convert ──
  convertBtn.addEventListener('click', async () => {
    const ordered = getOrderedFiles();
    if (ordered.length === 0) return;

    convertBtn.disabled = true;
    convertBtn.classList.add('loading');
    convertBtn.textContent = '変換中';
    hideStatus(statusEl);
    resetProgress(progressEl);

    try {
      const pdfBytes = await generatePDF(ordered, getOptions(root), progressEl);
      downloadPDF(pdfBytes, generateFilename(ordered));
      showStatus(statusEl, 'success',
        `PDF を生成しました（${ordered.length} 枚 ・ ${formatBytes(pdfBytes.length)}）`);
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `エラーが発生しました: ${err.message}`);
    } finally {
      convertBtn.disabled = false;
      convertBtn.classList.remove('loading');
      convertBtn.textContent = 'PDFに変換';
      resetProgress(progressEl);
    }
  });
})();
