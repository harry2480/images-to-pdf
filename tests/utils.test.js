import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  calcLayout,
  isTiff,
  isHeic,
  MM_TO_PT,
  PAGE_SIZES,
  MARGIN_PT,
  QUALITY_MAP
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
