(() => {
  const { PDFDocument, degrees } = PDFLib;

  // pt per mm (1pt = 1/72 inch, 1 inch = 25.4mm)
  const MM_TO_PT = 72 / 25.4;
  const PAGE_SIZES = {
    a4:     [210 * MM_TO_PT, 297 * MM_TO_PT],
    letter: [215.9 * MM_TO_PT, 279.4 * MM_TO_PT],
  };
  const MARGIN_PT = { none: 0, small: 14, large: 28 };

  // ── State ──
  let files = []; // { id, file }
  let nextId = 0;

  // ── DOM ──
  const dropZone    = document.getElementById('drop-zone');
  const fileInput   = document.getElementById('file-input');
  const selectBtn   = document.getElementById('select-btn');
  const workspace   = document.getElementById('workspace');
  const fileList    = document.getElementById('file-list');
  const addMoreBtn  = document.getElementById('add-more-btn');
  const convertBtn  = document.getElementById('convert-btn');
  const statusEl    = document.getElementById('status');

  // ── SortableJS ──
  Sortable.create(fileList, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: updateNumbers,
  });

  // ── File Input Events ──
  selectBtn.addEventListener('click', () => fileInput.click());
  addMoreBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    addFiles(e.target.files);
    e.target.value = '';
  });

  // ── Drag & Drop ──
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

  // ── Option Buttons ──
  document.querySelectorAll('.option-buttons').forEach(group => {
    group.addEventListener('click', e => {
      const btn = e.target.closest('.opt-btn');
      if (!btn) return;
      group.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ── Add Files ──
  function addFiles(fileList_) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    Array.from(fileList_).forEach(file => {
      if (!allowed.includes(file.type)) return;
      const id = nextId++;
      files.push({ id, file });
      renderCard({ id, file });
    });
    if (files.length > 0) showWorkspace();
    updateNumbers();
  }

  function showWorkspace() {
    dropZone.classList.add('hidden');
    workspace.classList.remove('hidden');
  }

  // ── Render Card ──
  function renderCard({ id, file }) {
    const card = document.createElement('div');
    card.className = 'file-card';
    card.dataset.id = id;

    const thumb = document.createElement('img');
    thumb.className = 'file-card-thumb';
    thumb.alt = file.name;
    const reader = new FileReader();
    reader.onload = e => { thumb.src = e.target.result; };
    reader.readAsDataURL(file);

    const num = document.createElement('span');
    num.className = 'file-card-num';

    const info = document.createElement('div');
    info.className = 'file-card-info';
    const name = document.createElement('div');
    name.className = 'file-card-name';
    name.textContent = file.name;
    info.appendChild(name);

    const del = document.createElement('button');
    del.className = 'file-card-delete';
    del.title = '削除';
    del.textContent = '×';
    del.addEventListener('click', e => {
      e.stopPropagation();
      removeFile(id, card);
    });

    card.appendChild(thumb);
    card.appendChild(num);
    card.appendChild(info);
    card.appendChild(del);
    fileList.appendChild(card);
  }

  function removeFile(id, card) {
    files = files.filter(f => f.id !== id);
    card.remove();
    updateNumbers();
    if (files.length === 0) {
      workspace.classList.add('hidden');
      dropZone.classList.remove('hidden');
      hideStatus();
    }
  }

  function updateNumbers() {
    const cards = fileList.querySelectorAll('.file-card');
    cards.forEach((card, i) => {
      card.querySelector('.file-card-num').textContent = i + 1;
    });
  }

  // ── Options ──
  function getOptions() {
    const orientation = document.querySelector('#opt-orientation .opt-btn.active').dataset.value;
    const pageSize    = document.querySelector('#opt-pagesize .opt-btn.active').dataset.value;
    const margin      = document.querySelector('#opt-margin .opt-btn.active').dataset.value;
    return { orientation, pageSize, margin };
  }

  function getOrderedFiles() {
    const cards = fileList.querySelectorAll('.file-card');
    return Array.from(cards).map(card => {
      const id = parseInt(card.dataset.id, 10);
      return files.find(f => f.id === id);
    }).filter(Boolean);
  }

  // ── Convert ──
  convertBtn.addEventListener('click', async () => {
    const ordered = getOrderedFiles();
    if (ordered.length === 0) return;

    convertBtn.disabled = true;
    convertBtn.classList.add('loading');
    convertBtn.textContent = '変換中';
    hideStatus();

    try {
      const pdfBytes = await generatePDF(ordered.map(o => o.file), getOptions());
      const firstName = ordered[0].file.name.replace(/\.[^.]+$/, '');
      const outName = ordered.length === 1 ? `${firstName}.pdf` : `${firstName}_and_${ordered.length - 1}_more.pdf`;
      downloadPDF(pdfBytes, outName);
      showStatus('success', `PDF を生成しました（${ordered.length} 枚）`);
    } catch (err) {
      console.error(err);
      showStatus('error', `エラーが発生しました: ${err.message}`);
    } finally {
      convertBtn.disabled = false;
      convertBtn.classList.remove('loading');
      convertBtn.textContent = 'PDFに変換';
    }
  });

  // ── PDF Generation ──
  function calcLayout(image, options, marginPt) {
    const landscape = options.orientation === 'landscape';

    if (options.pageSize === 'fit') {
      let w = image.width;
      let h = image.height;
      // swap for landscape
      if (landscape && w < h) { [w, h] = [h, w]; }
      if (!landscape && w > h) { [w, h] = [h, w]; }
      const imgW = w - marginPt * 2;
      const imgH = h - marginPt * 2;
      return { width: w, height: h, imgW, imgH };
    }

    let [baseW, baseH] = PAGE_SIZES[options.pageSize];
    if (landscape) { [baseW, baseH] = [baseH, baseW]; }

    const maxW = baseW - marginPt * 2;
    const maxH = baseH - marginPt * 2;
    const ratio = Math.min(maxW / image.width, maxH / image.height);
    const imgW = image.width * ratio;
    const imgH = image.height * ratio;

    // center image on page
    const x = marginPt + (maxW - imgW) / 2;
    const y = marginPt + (maxH - imgH) / 2;

    return { width: baseW, height: baseH, imgW, imgH, x, y };
  }

  async function generatePDF(fileArr, options) {
    const pdfDoc = await PDFDocument.create();
    const marginPt = MARGIN_PT[options.margin] ?? 0;

    for (const file of fileArr) {
      const bytes = await file.arrayBuffer();
      let image;
      if (file.type === 'image/jpeg') {
        image = await pdfDoc.embedJpg(bytes);
      } else if (file.type === 'image/png') {
        image = await pdfDoc.embedPng(bytes);
      } else {
        const pngBytes = await webpToPng(file);
        image = await pdfDoc.embedPng(pngBytes);
      }

      const layout = calcLayout(image, options, marginPt);
      const page = pdfDoc.addPage([layout.width, layout.height]);
      page.drawImage(image, {
        x: layout.x ?? marginPt,
        y: layout.y ?? marginPt,
        width: layout.imgW,
        height: layout.imgH,
      });
    }

    return await pdfDoc.save();
  }

  // ── WebP → PNG via Canvas ──
  function webpToPng(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => {
          blob.arrayBuffer().then(resolve).catch(reject);
        }, 'image/png');
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // ── Download ──
  function downloadPDF(pdfBytes, filename) {
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ── Status ──
  function showStatus(type, msg) {
    statusEl.textContent = msg;
    statusEl.className = `status ${type}`;
  }

  function hideStatus() {
    statusEl.className = 'status hidden';
  }
})();
