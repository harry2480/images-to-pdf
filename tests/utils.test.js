import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  calcLayout,
  isTiff,
  isHeic,
  MM_TO_PT,
  PAGE_SIZES,
  MARGIN_PT,
  QUALITY_MAP,
  IMAGE_OUTPUT_FORMATS,
  replaceExtension,
  uniqueName,
  planTiles,
  COMPRESS_LEVELS,
  resolveCompressFormat,
  isSameFormat,
  shouldKeepOriginal
} from '../js/utils.js';

describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats bytes under 1024', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 - 1)).toMatch(/\d+\.\d+ KB/);
  });

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});

describe('isTiff', () => {
  it('detects TIFF by MIME type', () => {
    expect(isTiff({ type: 'image/tiff', name: 'photo.tiff' })).toBe(true);
  });

  it('detects TIFF by extension (.tiff)', () => {
    expect(isTiff({ type: '', name: 'photo.tiff' })).toBe(true);
  });

  it('detects TIFF by extension (.tif)', () => {
    expect(isTiff({ type: '', name: 'photo.tif' })).toBe(true);
  });

  it('detects TIFF with uppercase extension', () => {
    expect(isTiff({ type: '', name: 'PHOTO.TIF' })).toBe(true);
    expect(isTiff({ type: '', name: 'PHOTO.TIFF' })).toBe(true);
  });

  it('rejects non-TIFF files', () => {
    expect(isTiff({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false);
    expect(isTiff({ type: 'image/png', name: 'photo.png' })).toBe(false);
    expect(isTiff({ type: '', name: 'photo.jpg' })).toBe(false);
  });

  it('handles files without names', () => {
    expect(isTiff({ type: 'image/tiff' })).toBe(true);
    expect(isTiff({ type: 'image/jpeg' })).toBe(false);
  });
});

describe('isHeic', () => {
  it('detects HEIC by MIME type (image/heic)', () => {
    expect(isHeic({ type: 'image/heic', name: 'photo.heic' })).toBe(true);
  });

  it('detects HEIF by MIME type (image/heif)', () => {
    expect(isHeic({ type: 'image/heif', name: 'photo.heif' })).toBe(true);
  });

  it('detects HEIC by extension (.heic)', () => {
    expect(isHeic({ type: '', name: 'photo.heic' })).toBe(true);
  });

  it('detects HEIC by extension (.heif)', () => {
    expect(isHeic({ type: '', name: 'photo.heif' })).toBe(true);
  });

  it('detects HEIC with uppercase extension', () => {
    expect(isHeic({ type: '', name: 'PHOTO.HEIC' })).toBe(true);
    expect(isHeic({ type: '', name: 'PHOTO.HEIF' })).toBe(true);
  });

  it('rejects non-HEIC files', () => {
    expect(isHeic({ type: 'image/jpeg', name: 'photo.jpg' })).toBe(false);
    expect(isHeic({ type: 'image/png', name: 'photo.png' })).toBe(false);
    expect(isHeic({ type: '', name: 'photo.jpg' })).toBe(false);
  });

  it('handles files without names', () => {
    expect(isHeic({ type: 'image/heic' })).toBe(true);
    expect(isHeic({ type: 'image/jpeg' })).toBe(false);
  });
});

describe('calcLayout', () => {
  describe('fit mode (portrait)', () => {
    it('returns image dimensions when pageSize is fit and portrait', () => {
      const result = calcLayout(
        { width: 100, height: 200 },
        { pageSize: 'fit', orientation: 'portrait' },
        0
      );
      expect(result.width).toBe(100);
      expect(result.height).toBe(200);
      expect(result.imgW).toBe(100);
      expect(result.imgH).toBe(200);
    });

    it('swaps dimensions if landscape image in portrait mode', () => {
      const result = calcLayout(
        { width: 200, height: 100 },
        { pageSize: 'fit', orientation: 'portrait' },
        0
      );
      expect(result.width).toBe(100);
      expect(result.height).toBe(200);
    });

    it('respects margins in fit mode', () => {
      const result = calcLayout(
        { width: 100, height: 200 },
        { pageSize: 'fit', orientation: 'portrait' },
        10
      );
      expect(result.imgW).toBe(100 - 20); // 10pt * 2
      expect(result.imgH).toBe(200 - 20);
    });
  });

  describe('fit mode (landscape)', () => {
    it('swaps dimensions if portrait image in landscape mode', () => {
      const result = calcLayout(
        { width: 100, height: 200 },
        { pageSize: 'fit', orientation: 'landscape' },
        0
      );
      expect(result.width).toBe(200);
      expect(result.height).toBe(100);
    });
  });

  describe('fixed page sizes (a4, a3, etc.)', () => {
    it('applies A4 size in portrait', () => {
      const [a4w, a4h] = PAGE_SIZES.a4;
      const result = calcLayout(
        { width: 1000, height: 2000 },
        { pageSize: 'a4', orientation: 'portrait' },
        0
      );
      expect(result.width).toBeCloseTo(a4w, 1);
      expect(result.height).toBeCloseTo(a4h, 1);
      expect(result.imgW).toBeLessThanOrEqual(a4w);
      expect(result.imgH).toBeLessThanOrEqual(a4h);
    });

    it('swaps dimensions for landscape mode', () => {
      const [a4w, a4h] = PAGE_SIZES.a4;
      const result = calcLayout(
        { width: 1000, height: 500 },
        { pageSize: 'a4', orientation: 'landscape' },
        0
      );
      expect(result.width).toBeCloseTo(a4h, 1); // width becomes height
      expect(result.height).toBeCloseTo(a4w, 1); // height becomes width
    });

    it('centers image with margin', () => {
      const margin = MARGIN_PT.small;
      const [a4w, a4h] = PAGE_SIZES.a4;
      const result = calcLayout(
        { width: 500, height: 500 },
        { pageSize: 'a4', orientation: 'portrait' },
        margin
      );
      const maxW = a4w - margin * 2;
      const maxH = a4h - margin * 2;
      const ratio = Math.min(maxW / 500, maxH / 500);
      const imgW = 500 * ratio;
      const imgH = 500 * ratio;
      const expectedX = margin + (maxW - imgW) / 2;
      const expectedY = margin + (maxH - imgH) / 2;
      expect(result.x).toBeCloseTo(expectedX, 1);
      expect(result.y).toBeCloseTo(expectedY, 1);
    });

    it('maintains aspect ratio', () => {
      const result = calcLayout(
        { width: 1000, height: 500 },
        { pageSize: 'a4', orientation: 'portrait' },
        0
      );
      const aspectIn = 1000 / 500; // 2.0
      const aspectOut = result.imgW / result.imgH;
      expect(aspectOut).toBeCloseTo(aspectIn, 1);
    });

    it('works with all page sizes', () => {
      const sizes = ['a3', 'a4', 'a5', 'b5', 'letter'];
      sizes.forEach(size => {
        const result = calcLayout(
          { width: 1000, height: 1000 },
          { pageSize: size, orientation: 'portrait' },
          0
        );
        expect(result.width).toBeGreaterThan(0);
        expect(result.height).toBeGreaterThan(0);
        expect(result.imgW).toBeGreaterThan(0);
        expect(result.imgH).toBeGreaterThan(0);
      });
    });
  });
});

describe('Constants', () => {
  it('MM_TO_PT is defined', () => {
    expect(MM_TO_PT).toBeCloseTo(72 / 25.4, 2);
  });

  it('PAGE_SIZES contains all expected formats', () => {
    expect(PAGE_SIZES).toHaveProperty('a3');
    expect(PAGE_SIZES).toHaveProperty('a4');
    expect(PAGE_SIZES).toHaveProperty('a5');
    expect(PAGE_SIZES).toHaveProperty('b5');
    expect(PAGE_SIZES).toHaveProperty('letter');
  });

  it('PAGE_SIZES values are arrays with two numbers', () => {
    Object.values(PAGE_SIZES).forEach(([w, h]) => {
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
    });
  });

  it('MARGIN_PT has expected values', () => {
    expect(MARGIN_PT.none).toBe(0);
    expect(MARGIN_PT.small).toBe(14);
    expect(MARGIN_PT.large).toBe(28);
  });

  it('QUALITY_MAP has expected values', () => {
    expect(QUALITY_MAP.high).toBe(0.92);
    expect(QUALITY_MAP.medium).toBe(0.75);
    expect(QUALITY_MAP.small).toBe(0.45);
  });
});

describe('IMAGE_OUTPUT_FORMATS', () => {
  it('maps each format to a MIME type and extension', () => {
    expect(IMAGE_OUTPUT_FORMATS.jpeg).toEqual({ mime: 'image/jpeg', ext: 'jpg', lossy: true });
    expect(IMAGE_OUTPUT_FORMATS.png).toEqual({ mime: 'image/png', ext: 'png', lossy: false });
    expect(IMAGE_OUTPUT_FORMATS.webp).toEqual({ mime: 'image/webp', ext: 'webp', lossy: true });
  });
});

describe('replaceExtension', () => {
  it('swaps the extension', () => {
    expect(replaceExtension('photo.png', 'jpg')).toBe('photo.jpg');
    expect(replaceExtension('IMG_0001.HEIC', 'jpg')).toBe('IMG_0001.jpg');
  });

  it('only touches the last extension', () => {
    expect(replaceExtension('archive.tar.png', 'webp')).toBe('archive.tar.webp');
  });

  it('appends when there is no extension', () => {
    expect(replaceExtension('photo', 'png')).toBe('photo.png');
  });

  it('falls back to a default base for empty or dot-only names', () => {
    expect(replaceExtension('', 'jpg')).toBe('image.jpg');
    expect(replaceExtension('.png', 'jpg')).toBe('image.jpg');
    expect(replaceExtension(undefined, 'jpg')).toBe('image.jpg');
  });
});

describe('uniqueName', () => {
  it('returns the name unchanged when unused and records it', () => {
    const used = new Set();
    expect(uniqueName('a.jpg', used)).toBe('a.jpg');
    expect(used.has('a.jpg')).toBe(true);
  });

  it('appends a counter before the extension on collision', () => {
    const used = new Set();
    expect(uniqueName('a.jpg', used)).toBe('a.jpg');
    expect(uniqueName('a.jpg', used)).toBe('a (2).jpg');
    expect(uniqueName('a.jpg', used)).toBe('a (3).jpg');
  });

  it('skips counters that are already taken', () => {
    const used = new Set(['a.jpg', 'a (2).jpg']);
    expect(uniqueName('a.jpg', used)).toBe('a (3).jpg');
  });

  it('handles names without an extension', () => {
    const used = new Set(['a']);
    expect(uniqueName('a', used)).toBe('a (2)');
  });
});

describe('planTiles', () => {
  it('covers every pixel exactly once with the tile cores', () => {
    const W = 1000, H = 750;
    const tiles = planTiles(W, H, 256, 16);
    expect(tiles).toHaveLength(12);
    const area = tiles.reduce((s, t) => s + t.w * t.h, 0);
    expect(area).toBe(W * H);
  });

  it('adds padding only where the image has neighbouring pixels', () => {
    const [first, second] = planTiles(600, 100, 256, 16);
    expect(first).toEqual({ x: 0, y: 0, w: 256, h: 100, px: 0, py: 0, pw: 272, ph: 100 });
    expect(second).toEqual({ x: 256, y: 0, w: 256, h: 100, px: 240, py: 0, pw: 288, ph: 100 });
  });

  it('clips the last tile to the image edge', () => {
    const tiles = planTiles(300, 300, 256, 16);
    const last = tiles[tiles.length - 1];
    expect(last).toMatchObject({ x: 256, y: 256, w: 44, h: 44, px: 240, py: 240, pw: 60, ph: 60 });
  });

  it('handles images smaller than one tile', () => {
    expect(planTiles(10, 5, 256, 16)).toEqual([{ x: 0, y: 0, w: 10, h: 5, px: 0, py: 0, pw: 10, ph: 5 }]);
  });
});

describe('COMPRESS_LEVELS', () => {
  it('orders quality strong < medium < light within (0, 1)', () => {
    expect(COMPRESS_LEVELS.strong).toBeGreaterThan(0);
    expect(COMPRESS_LEVELS.strong).toBeLessThan(COMPRESS_LEVELS.medium);
    expect(COMPRESS_LEVELS.medium).toBeLessThan(COMPRESS_LEVELS.light);
    expect(COMPRESS_LEVELS.light).toBeLessThan(1);
  });
});

describe('resolveCompressFormat', () => {
  const jpg  = { type: 'image/jpeg', name: 'a.jpg' };
  const png  = { type: 'image/png',  name: 'a.png' };
  const webp = { type: 'image/webp', name: 'a.webp' };
  const gif  = { type: 'image/gif',  name: 'a.gif' };
  const heic = { type: '',           name: 'a.HEIC' };

  it('keeps JPG / PNG / WebP when "original" is chosen', () => {
    expect(resolveCompressFormat(jpg, 'original', true)).toBe('jpeg');
    expect(resolveCompressFormat(png, 'original', true)).toBe('png');
    expect(resolveCompressFormat(webp, 'original', true)).toBe('webp');
  });

  it('falls back to JPEG for formats the canvas cannot write', () => {
    expect(resolveCompressFormat(gif, 'original', true)).toBe('jpeg');
    expect(resolveCompressFormat(heic, 'original', true)).toBe('jpeg');
  });

  it('detects PNG / WebP by extension when MIME is empty', () => {
    expect(resolveCompressFormat({ type: '', name: 'x.PNG' }, 'original', true)).toBe('png');
    expect(resolveCompressFormat({ type: '', name: 'x.webp' }, 'original', true)).toBe('webp');
  });

  it('uses JPEG instead of WebP when the browser cannot encode WebP', () => {
    expect(resolveCompressFormat(webp, 'original', false)).toBe('jpeg');
    expect(resolveCompressFormat(png, 'webp', false)).toBe('jpeg');
  });

  it('honours an explicit output format', () => {
    expect(resolveCompressFormat(png, 'jpeg', true)).toBe('jpeg');
    expect(resolveCompressFormat(jpg, 'webp', true)).toBe('webp');
  });
});

describe('isSameFormat', () => {
  it('matches by MIME or extension', () => {
    expect(isSameFormat({ type: 'image/jpeg', name: 'a' }, 'jpeg')).toBe(true);
    expect(isSameFormat({ type: '', name: 'a.JPEG' }, 'jpeg')).toBe(true);
    expect(isSameFormat({ type: 'image/png', name: 'a.png' }, 'jpeg')).toBe(false);
    expect(isSameFormat({ type: 'image/gif', name: 'a.gif' }, 'jpeg')).toBe(false);
  });
});

describe('shouldKeepOriginal', () => {
  const jpg = { type: 'image/jpeg', name: 'a.jpg', size: 1000 };

  it('keeps the original when same-format output is not smaller', () => {
    expect(shouldKeepOriginal(jpg, 'jpeg', 1000)).toBe(true);
    expect(shouldKeepOriginal(jpg, 'jpeg', 1200)).toBe(true);
  });

  it('uses the new output when it is smaller', () => {
    expect(shouldKeepOriginal(jpg, 'jpeg', 999)).toBe(false);
  });

  it('never keeps the original when the format changes', () => {
    expect(shouldKeepOriginal(jpg, 'webp', 5000)).toBe(false);
  });
});
