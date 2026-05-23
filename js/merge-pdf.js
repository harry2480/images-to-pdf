// Merge multiple PDFs into one (pdf-lib copyPages).
(() => {
  const {
    PDFDocument, MAX_FILES, MAX_TOTAL_BYTES,
    downloadPDF, formatBytes, showStatus, hideStatus, openPreview,
  } = PdfApp;

  // ── State ──
  let files = []; // { id, file }
  let nextId = 0;
  let lastPdfBytes = null;

  // ── DOM ──
  const dropZone   = document.getElementById('merge-drop-zone');
  const fileInput  = document.getElementById('merge-file-input');
  const selectBtn  = document.getElementById('merge-select-btn');
  const workspace  = document.getElementById('merge-workspace');
  const fileList   = document.getElementById('merge-file-list');
  const addMoreBtn = document.getElementById('merge-add-more-btn');
  const mergeBtn   = document.getElementById('merge-btn');
  const previewBtn = document.getElementById('merge-preview-btn');
  const statusEl   = document.getElementById('merge-status');

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

  // ── Add files ──
  function isPdf(f) {
    return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  }

  function addFiles(fileList_) {
    const incoming = Array.from(fileList_).filter(isPdf);
    let total = files.reduce((s, e) => s + e.file.size, 0);
    let skipped = 0;

    for (const file of incoming) {
      if (files.length >= MAX_FILES || total + file.size > MAX_TOTAL_BYTES) { skipped++; continue; }
      const id = nextId++;
      files.push({ id, file });
      renderCard({ id, file });
      total += file.size;
    }

    if (files.length > 0) showWorkspace();
    updateNumbers();
    if (skipped > 0) {
      showStatus(statusEl, 'error',
        `上限（${MAX_FILES}件 / ${formatBytes(MAX_TOTAL_BYTES)}）を超えるため ${skipped} 件を追加できませんでした`);
    }
  }

  function showWorkspace() {
    dropZone.classList.add('hidden');
    workspace.classList.remove('hidden');
  }

  function resetToDropZone() {
    workspace.classList.add('hidden');
    dropZone.classList.remove('hidden');
    hideStatus(statusEl);
  }

  // ── Render card (generic PDF icon, no thumbnail) ──
  function renderCard({ id, file }) {
    const card = document.createElement('div');
    card.className = 'file-card pdf-card';
    card.dataset.id = id;

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'file-card-thumb-wrap pdf-thumb';
    const icon = document.createElement('span');
    icon.className = 'pdf-icon';
    icon.textContent = 'PDF';
    thumbWrap.appendChild(icon);

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
    footer.appendChild(name);

    card.appendChild(thumbWrap);
    card.appendChild(num);
    card.appendChild(del);
    card.appendChild(footer);
    fileList.appendChild(card);
  }

  function removeFile(id, card) {
    files = files.filter(f => f.id !== id);
    card.remove();
    updateNumbers();
    if (files.length === 0) resetToDropZone();
  }

  function updateNumbers() {
    fileList.querySelectorAll('.file-card').forEach((card, i) => {
      card.querySelector('.file-card-num').textContent = i + 1;
    });
  }

  function getOrderedFiles() {
    return Array.from(fileList.querySelectorAll('.file-card'))
      .map(card => files.find(f => f.id === parseInt(card.dataset.id, 10)))
      .filter(Boolean);
  }

  // ── Merge ──
  async function mergePDFs(ordered) {
    const out = await PDFDocument.create();
    const failed = [];

    for (const entry of ordered) {
      try {
        const src = await PDFDocument.load(await entry.file.arrayBuffer());
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(p => out.addPage(p));
      } catch (err) {
        // Skip unreadable/corrupt/encrypted PDFs rather than failing the batch.
        console.error(err);
        failed.push(entry.file.name);
      }
    }

    if (out.getPageCount() === 0) {
      throw new Error('結合できるPDFがありませんでした');
    }
    const bytes = await out.save();
    return { bytes, failed, pageCount: out.getPageCount() };
  }

  function mergedFilename(ordered) {
    if (!ordered || ordered.length === 0) return 'merged.pdf';
    const first = ordered[0].file.name.replace(/\.[^.]+$/, '');
    return `${first}_merged.pdf`;
  }

  function warnIfFailed(failed) {
    if (failed.length > 0) {
      showStatus(statusEl, 'error',
        `${failed.length} 件のPDFを読み込めずスキップしました: ${failed.join(', ')}`);
    }
  }

  // ── Preview ──
  previewBtn.addEventListener('click', async () => {
    const ordered = getOrderedFiles();
    if (ordered.length === 0) return;

    previewBtn.disabled = true;
    previewBtn.classList.add('loading');
    previewBtn.textContent = '生成中';
    hideStatus(statusEl);

    try {
      const { bytes, failed } = await mergePDFs(ordered);
      lastPdfBytes = bytes;
      openPreview(bytes, () => downloadPDF(lastPdfBytes, mergedFilename(ordered)));
      warnIfFailed(failed);
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `エラーが発生しました: ${err.message}`);
    } finally {
      previewBtn.disabled = false;
      previewBtn.classList.remove('loading');
      previewBtn.textContent = 'プレビュー';
    }
  });

  // ── Merge & download ──
  mergeBtn.addEventListener('click', async () => {
    const ordered = getOrderedFiles();
    if (ordered.length === 0) return;

    mergeBtn.disabled = true;
    mergeBtn.classList.add('loading');
    mergeBtn.textContent = '結合中';
    hideStatus(statusEl);

    try {
      const { bytes, failed, pageCount } = await mergePDFs(ordered);
      downloadPDF(bytes, mergedFilename(ordered));
      if (failed.length > 0) {
        warnIfFailed(failed);
      } else {
        showStatus(statusEl, 'success',
          `PDF を結合しました（${pageCount} ページ ・ ${formatBytes(bytes.length)}）`);
      }
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `エラーが発生しました: ${err.message}`);
    } finally {
      mergeBtn.disabled = false;
      mergeBtn.classList.remove('loading');
      mergeBtn.textContent = 'PDFを結合';
    }
  });
})();
