// Pure functions for utilities (ES Module format for testing)

// Constants
export const MM_TO_PT = 72 / 25.4;
export const PAGE_SIZES = {
  a3:     [297 * MM_TO_PT, 420 * MM_TO_PT],
  a4:     [210 * MM_TO_PT, 297 * MM_TO_PT],
  a5:     [148 * MM_TO_PT, 210 * MM_TO_PT],
  b5:     [176 * MM_TO_PT, 250 * MM_TO_PT],
  letter: [215.9 * MM_TO_PT, 279.4 * MM_TO_PT],
};
export const MARGIN_PT = { none: 0, small: 14, large: 28 };
export const QUALITY_MAP = { high: 0.92, medium: 0.75, small: 0.45 };

// Formatting: bytes to human-readable string
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// PDF layout calculation
export function calcLayout(image, options, marginPt) {
  const landscape = options.orientation === 'landscape';

  if (options.pageSize === 'fit') {
    let w = image.width;
    let h = image.height;
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

  const x = marginPt + (maxW - imgW) / 2;
  const y = marginPt + (maxH - imgH) / 2;

  return { width: baseW, height: baseH, imgW, imgH, x, y };
}

// File format detection
export function isTiff(file) {
  return file.type === 'image/tiff' || /\.tiff?$/i.test(file.name || '');
}

export function isHeic(file) {
  return /image\/hei[cf]/.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
}

// ── Image format conversion ──
export const IMAGE_OUTPUT_FORMATS = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg',  lossy: true },
  png:  { mime: 'image/png',  ext: 'png',  lossy: false },
  webp: { mime: 'image/webp', ext: 'webp', lossy: true },
};

// "photo.HEIC" + "jpg" → "photo.jpg". Names without an extension get one appended.
export function replaceExtension(name, ext) {
  const base = (name || '').replace(/\.[^.]+$/, '');
  return `${base || 'image'}.${ext}`;
}

// Make `name` unique within `used` (a Set that is mutated): a.jpg, a (2).jpg, a (3).jpg …
// Needed because different sources (a.png, a.heic) collapse to the same output name.
export function uniqueName(name, used) {
  const m = name.match(/^(.*?)(\.[^.]*)?$/);
  const base = m[1];
  const ext = m[2] || '';
  let candidate = name;
  for (let n = 2; used.has(candidate); n++) candidate = `${base} (${n})${ext}`;
  used.add(candidate);
  return candidate;
}

// ── AI enhancement tiling (kept in sync with js/enhance-worker.js) ──
// Split the image into tile-sized cores, each with up to `pad` px of context on every side.
export function planTiles(width, height, tile, pad) {
  const tiles = [];
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      const w = Math.min(tile, width - x);
      const h = Math.min(tile, height - y);
      const px = Math.max(0, x - pad);
      const py = Math.max(0, y - pad);
      tiles.push({
        x, y, w, h, px, py,
        pw: Math.min(width, x + w + pad) - px,
        ph: Math.min(height, y + h + pad) - py,
      });
    }
  }
  return tiles;
}
