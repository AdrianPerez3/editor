import { describe, expect, it } from 'vitest';
import {
  bboxCenter,
  dxfToLevel,
  emptyBbox,
  expandBbox,
  isBboxValid,
  scalePoint,
  translatePoint,
} from '../src/coords.js';

describe('dxfToLevel', () => {
  it('flips Y to convert DXF (Z-up) plan to editor (Y-up) XZ', () => {
    expect(dxfToLevel([3, 5])).toEqual([3, -5]);
    expect(dxfToLevel([0, 0])).toEqual([0, 0]);
    expect(dxfToLevel([-2, -7])).toEqual([-2, 7]);
  });
});

describe('scalePoint', () => {
  it('scales both axes uniformly', () => {
    expect(scalePoint([1000, 2000], 0.001)).toEqual([1, 2]);
  });
});

describe('translatePoint', () => {
  it('subtracts the offset (translates toward origin)', () => {
    expect(translatePoint([10, 10], [3, 4])).toEqual([7, 6]);
  });
});

describe('bbox helpers', () => {
  it('expands and reports center correctly', () => {
    const b = emptyBbox();
    expect(isBboxValid(b)).toBe(false);
    expandBbox(b, [-5, -3]);
    expandBbox(b, [5, 3]);
    expect(isBboxValid(b)).toBe(true);
    expect(bboxCenter(b)).toEqual([0, 0]);
  });

  it('rejects degenerate empty bboxes', () => {
    const b = emptyBbox();
    expect(isBboxValid(b)).toBe(false);
  });
});
