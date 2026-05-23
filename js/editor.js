// Crop / rotate editor modal (Cropper.js). Exposed as PdfApp.openCropEditor.
(() => {
  const modal    = document.getElementById('crop-modal');
  const overlay  = document.getElementById('crop-overlay');
  const img      = document.getElementById('crop-img');
  const closeBtn = document.getElementById('crop-close');
  const cancel   = document.getElementById('crop-cancel');
  const apply    = document.getElementById('crop-apply');
  const rotL     = document.getElementById('crop-rotate-l');
  const rotR     = document.getElementById('crop-rotate-r');
  const reset    = document.getElementById('crop-reset');
  const aspects  = document.getElementById('crop-aspects');

  let cropper = null;
  let currentUrl = null;
  let applyCb = null;

  // file: File|Blob to edit. onApply(blob) receives the cropped JPEG/PNG blob.
  function openCropEditor(file, onApply) {
    applyCb = onApply;
    currentUrl = URL.createObjectURL(file);
    img.src = currentUrl;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    const isPng = file.type === 'image/png';
    cropper = new Cropper(img, {
      viewMode: 1,
      autoCropArea: 1,
      background: false,
      // Stash output type on the instance for the apply step.
    });
    cropper._outType = isPng ? 'image/png' : 'image/jpeg';
  }

  function teardown() {
    if (cropper) { cropper.destroy(); cropper = null; }
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
    img.src = '';
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    applyCb = null;
  }

  rotL.addEventListener('click', () => cropper && cropper.rotate(-90));
  rotR.addEventListener('click', () => cropper && cropper.rotate(90));
  reset.addEventListener('click', () => cropper && cropper.reset());

  aspects.addEventListener('click', e => {
    const btn = e.target.closest('.opt-btn');
    if (!btn || !cropper) return;
    aspects.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const v = btn.dataset.value; // 'free' | '1' | '1.3333' | '1.7778'
    cropper.setAspectRatio(v === 'free' ? NaN : parseFloat(v));
  });

  apply.addEventListener('click', () => {
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({ maxWidth: 8000, maxHeight: 8000 });
    if (!canvas) { teardown(); return; }
    const outType = cropper._outType;
    const q = outType === 'image/jpeg' ? 0.95 : undefined;
    const cb = applyCb;
    canvas.toBlob(blob => {
      if (blob && cb) cb(blob);
      teardown();
    }, outType, q);
  });

  closeBtn.addEventListener('click', teardown);
  cancel.addEventListener('click', teardown);
  overlay.addEventListener('click', teardown);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) teardown();
  });

  PdfApp.openCropEditor = openCropEditor;
})();
