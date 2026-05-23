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
