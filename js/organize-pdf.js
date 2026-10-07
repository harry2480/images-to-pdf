// PDF Page Organizer — reorder / delete / extract pages of one PDF.
(() => {
  const { PDFDocument, showStatus, hideStatus, showProgress, resetProgress,
          getOptions, downloadPDF, openPreview } = PdfApp;

  // ── Pure helpers (kept in sync with js/utils.js, which is test-only) ──
  // pages: [{ src, selected }] in display order → source page indices to write.
  function resolveOrganizeOutput(pages, scope) {
    const picked = scope === 'selected' ? pages.filter(p => p.selected) : pages;
    return picked.map(p => p.src);
  }

  const THUMB_WIDTH = 160;

  let pdfFile = null;
  let pdfDoc = null;      // pdf-lib document, source of the output
  let thumbDoc = null;    // pdf.js document, alive only while thumbnails are being drawn
  let cards = [];         // every card by source index, so 「最初に戻す」 can bring deleted ones back
  let renderToken = 0;    // invalidates thumbnail rendering of a previously opened file
  let busy = false;       // loading or building a PDF; blocks every other action
  let progressTimer = null;

  const root        = document.querySelector('section[data-tool="organize-pdf"]');
  const dropZone    = document.getElementById('org-drop-zone');
  const fileInput   = document.getElementById('org-file-input');
  const selectBtn   = document.getElementById('org-select-btn');
  const workspace   = document.getElementById('org-workspace');
  const infoEl      = document.getElementById('org-info');
  const pagesEl     = document.getElementById('org-pages');
  const emptyEl     = document.getElementById('org-empty');
  const selectAll   = document.getElementById('org-select-all');
  const deleteSel   = document.getElementById('org-delete-selected');
  const resetBtn    = document.getElementById('org-reset');
  const changeBtn   = document.getElementById('org-change-file');
  const scopeGroup  = root.querySelector('.option-buttons[data-opt="scope"]');
  const previewBtn  = document.getElementById('org-preview-btn');
  const saveBtn     = document.getElementById('org-save-btn');
  const progressEl  = document.getElementById('org-progress');
  const statusEl    = document.getElementById('org-status');

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
  }

  const sortable = Sortable.create(pagesEl, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    // Let buttons / checkboxes inside a card receive normal clicks.
    filter: 'button, input',
    preventOnFilter: false,
    // On touch, a short hold starts the drag so plain swipes still scroll the page.
    delay: 150,
    delayOnTouchOnly: true,
    onEnd: updateState,
  });

  // ── File input / drag-drop ──
  const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

  selectBtn.addEventListener('click', () => fileInput.click());
  changeBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadPdf(e.target.files[0]);
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
    const f = Array.from(e.dataTransfer.files).find(isPdf);
    if (f) loadPdf(f);
    else showStatus(statusEl, 'error', 'PDF ファイルを選択してください');
  });

  // ── Load ──
  async function loadPdf(file) {
    if (busy) return;
    if (!isPdf(file)) {
      showStatus(statusEl, 'error', 'PDF ファイルを選択してください');
      return;
    }
    // Saving while a new file parses would copy the new file's pages in the old order.
    setBusy(true);
    hideStatus(statusEl);
    let doc;
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      doc = await PDFDocument.load(bytes);
    } catch (err) {
      console.error(err);
      const msg = /encrypt/i.test(err.message)
        ? 'パスワードや編集制限で保護された PDF は整理できません'
        : 'PDF を読み込めませんでした。ファイルが壊れていないか確認してください';
      showStatus(statusEl, 'error', msg);
      return;
    } finally {
      setBusy(false);
    }

    // Only a successful load replaces the open file, so a failed one leaves its thumbnails alone.
    const token = ++renderToken;
    if (thumbDoc) thumbDoc.destroy();
    thumbDoc = null;
    pdfFile = file;
    pdfDoc = doc;

    const count = doc.getPageCount();
    cards = Array.from({ length: count }, (_, i) => createCard(i));
    pagesEl.replaceChildren(...cards);
    dropZone.classList.add('hidden');
    workspace.classList.remove('hidden');
    updateState();

    renderThumbnails(bytes, cards, token);
  }

  // pdf.js transfers the buffer it is given to its worker, so it gets a copy
  // and pdf-lib keeps the original.
  // The pdf.js document is destroyed as soon as the canvases exist, so its worker
  // copy of the file does not stay in memory next to pdf-lib's.
  async function renderThumbnails(bytes, targets, token) {
    if (typeof pdfjsLib === 'undefined') return;
    let doc = null;
    try {
      doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      if (token !== renderToken) return;
      thumbDoc = doc;
      for (let i = 0; i < targets.length; i++) {
        const page = await doc.getPage(i + 1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        page.cleanup();
        if (token !== renderToken) return;
        targets[i].querySelector('.org-thumb').replaceChildren(canvas);
      }
    } catch (err) {
      // Thumbnails are a convenience; the page numbers still let the user work.
      // A destroyed document (another file was opened) also lands here.
      if (token === renderToken) console.warn('Thumbnail rendering failed:', err);
    } finally {
      if (doc) doc.destroy();
      if (thumbDoc === doc) thumbDoc = null;
    }
  }

  function createCard(src) {
    const card = document.createElement('div');
    card.className = 'org-page';
    card.setAttribute('role', 'listitem');
    card.dataset.src = src;
    card.innerHTML = `
      <label class="org-check">
        <input type="checkbox" aria-label="元の ${src + 1} ページを選択">
      </label>
      <div class="org-thumb"><span class="org-thumb-placeholder">${src + 1}</span></div>
      <div class="org-page-bar">
        <button type="button" class="org-icon-btn" data-action="prev" aria-label="元の ${src + 1} ページを前へ移動">←</button>
        <span class="org-page-label"><span class="org-pos"></span><span class="org-src">元 ${src + 1}</span></span>
        <button type="button" class="org-icon-btn" data-action="next" aria-label="元の ${src + 1} ページを後ろへ移動">→</button>
        <button type="button" class="org-icon-btn danger" data-action="delete" aria-label="元の ${src + 1} ページを削除">×</button>
      </div>`;
    return card;
  }

  // ── Card actions (delegated) ──
  pagesEl.addEventListener('click', e => {
    if (busy) {
      // Also undoes a checkbox toggled from the keyboard.
      e.preventDefault();
      return;
    }
    const card = e.target.closest('.org-page');
    if (!card) return;
    const btn = e.target.closest('button[data-action]');
    if (btn) {
      const action = btn.dataset.action;
      if (action === 'delete') {
        const next = card.nextElementSibling || card.previousElementSibling;
        card.remove();
        updateState();
        focusFirst(next?.querySelector('[data-action="delete"]'), resetBtn);
        return;
      }
      if (action === 'prev' && card.previousElementSibling) {
        pagesEl.insertBefore(card, card.previousElementSibling);
      } else if (action === 'next' && card.nextElementSibling) {
        pagesEl.insertBefore(card.nextElementSibling, card);
      }
      updateState();
      // At either end the pressed button turns disabled and would drop focus to <body>.
      const other = card.querySelector(`[data-action="${action === 'prev' ? 'next' : 'prev'}"]`);
      focusFirst(btn, other, card.querySelector('[data-action="delete"]'));
      return;
    }
    if (e.target.closest('.org-thumb')) {
      const box = card.querySelector('input[type="checkbox"]');
      box.checked = !box.checked;
    }
    updateState();
  });

  selectAll.addEventListener('click', () => {
    const boxes = [...pagesEl.querySelectorAll('input[type="checkbox"]')];
    const check = !boxes.every(b => b.checked);
    boxes.forEach(b => { b.checked = check; });
    updateState();
  });

  deleteSel.addEventListener('click', () => {
    pagesEl.querySelectorAll('.org-page').forEach(card => {
      if (card.querySelector('input[type="checkbox"]').checked) card.remove();
    });
    updateState();
    focusFirst(selectAll, resetBtn);
  });

  resetBtn.addEventListener('click', () => {
    cards.forEach(card => { card.querySelector('input[type="checkbox"]').checked = false; });
    pagesEl.replaceChildren(...cards);
    hideStatus(statusEl);
    updateState();
  });

  scopeGroup.addEventListener('click', updateState);

  function focusFirst(...els) {
    els.find(el => el && !el.disabled)?.focus();
  }

  // ── State ──
  function setBusy(value) {
    busy = value;
    sortable.option('disabled', value);
    pagesEl.classList.toggle('org-busy', value);
    updateState();
  }

  function readPages() {
    return [...pagesEl.querySelectorAll('.org-page')].map(card => ({
      src: Number(card.dataset.src),
      selected: card.querySelector('input[type="checkbox"]').checked,
    }));
  }

  function updateState() {
    const pages = readPages();
    const cardEls = pagesEl.querySelectorAll('.org-page');
    cardEls.forEach((card, i) => {
      card.querySelector('.org-pos').textContent = i + 1;
      card.classList.toggle('selected', pages[i].selected);
      card.querySelector('[data-action="prev"]').disabled = i === 0;
      card.querySelector('[data-action="next"]').disabled = i === cardEls.length - 1;
    });

    const selectedCount = pages.filter(p => p.selected).length;
    const { scope } = getOptions(root);
    const outCount = resolveOrganizeOutput(pages, scope).length;

    if (pdfFile) {
      infoEl.textContent = `${pdfFile.name} ・ ${pages.length} / ${cards.length} ページ`
        + (selectedCount ? ` ・ ${selectedCount} ページ選択中` : '');
    }
    emptyEl.classList.toggle('hidden', !pdfFile || pages.length > 0);
    scopeGroup.querySelectorAll('.opt-btn').forEach(b => {
      b.setAttribute('aria-pressed', b.classList.contains('active'));
    });
    selectAll.textContent = pages.length && selectedCount === pages.length ? '選択を解除' : 'すべて選択';
    selectAll.disabled = busy || pages.length === 0;
    deleteSel.disabled = busy || selectedCount === 0;
    resetBtn.disabled = busy;
    changeBtn.disabled = busy;
    previewBtn.disabled = busy || outCount === 0;
    saveBtn.disabled = busy || outCount === 0;
    saveBtn.textContent = outCount ? `${outCount} ページを保存` : '保存するページがありません';
  }

  // ── Output ──
  // Everything the output depends on is read up front, so nothing changes under it.
  async function buildPdf() {
    const srcDoc = pdfDoc;
    const name = `organized-${pdfFile.name.replace(/\.pdf$/i, '')}.pdf`;
    const indices = resolveOrganizeOutput(readPages(), getOptions(root).scope);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(srcDoc, indices);
    copied.forEach(page => out.addPage(page));
    return { bytes: await out.save(), count: indices.length, name };
  }

  async function run(action) {
    if (busy) return;
    clearTimeout(progressTimer);
    setBusy(true);
    hideStatus(statusEl);
    try {
      // copyPages/save give no progress callbacks, so show a single "working" state.
      showProgress(progressEl, 50, '作成中…');
      const result = await buildPdf();
      showProgress(progressEl, 100);
      action(result);
    } catch (err) {
      console.error(err);
      showStatus(statusEl, 'error', `PDF を作成できませんでした: ${err.message}`);
    } finally {
      setBusy(false);
      progressTimer = setTimeout(() => resetProgress(progressEl), 500);
    }
  }

  previewBtn.addEventListener('click', () => run(({ bytes, name }) => {
    openPreview(bytes, () => downloadPDF(bytes, name));
  }));

  saveBtn.addEventListener('click', () => run(({ bytes, count, name }) => {
    downloadPDF(bytes, name);
    showStatus(statusEl, 'success', `完了: ${count} ページの PDF を保存しました`);
  }));
})();
