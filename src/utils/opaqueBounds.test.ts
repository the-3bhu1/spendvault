import { describe, it, expect } from 'vitest';
import { opaqueBounds } from './opaqueBounds';

const canvas = (width: number, height: number, inked: Array<[number, number, number]>) => {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha] of inked) rgba[(y * width + x) * 4 + 3] = alpha;
  return rgba;
};

describe('opaqueBounds', () => {
  it('finds the artwork inside a transparent margin', () => {
    const rgba = canvas(10, 6, [[3, 2, 255], [7, 4, 255], [5, 1, 120]]);
    expect(opaqueBounds(rgba, 10, 6, 8)).toEqual({ minX: 3, minY: 1, maxX: 7, maxY: 4 });
  });

  it('ignores faint pixels at or below the alpha floor', () => {
    const rgba = canvas(10, 6, [[0, 0, 8], [9, 5, 4], [4, 3, 255]]);
    expect(opaqueBounds(rgba, 10, 6, 8)).toEqual({ minX: 4, minY: 3, maxX: 4, maxY: 3 });
  });

  it('spans the whole image when the artwork reaches every edge', () => {
    const rgba = canvas(4, 3, [[0, 0, 255], [3, 2, 255]]);
    expect(opaqueBounds(rgba, 4, 3, 8)).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 2 });
  });

  it('returns null for a fully transparent image', () => {
    expect(opaqueBounds(canvas(5, 5, []), 5, 5, 8)).toBeNull();
  });
});
