import { describe, expect, it } from 'vitest';
import {
  inferUnitFromBbox,
  metersPerUnit,
  unitFromInsunits,
} from '../src/units.js';

describe('unitFromInsunits', () => {
  it('maps every documented INSUNITS code to its unit', () => {
    expect(unitFromInsunits(0)).toBe('unitless');
    expect(unitFromInsunits(1)).toBe('in');
    expect(unitFromInsunits(2)).toBe('ft');
    expect(unitFromInsunits(4)).toBe('mm');
    expect(unitFromInsunits(5)).toBe('cm');
    expect(unitFromInsunits(6)).toBe('m');
    expect(unitFromInsunits(7)).toBe('km');
  });

  it('falls back to unitless for unknown codes', () => {
    expect(unitFromInsunits(999)).toBe('unitless');
    expect(unitFromInsunits(undefined)).toBe('unitless');
  });
});

describe('metersPerUnit', () => {
  it('returns the canonical conversion factors', () => {
    expect(metersPerUnit('mm')).toBeCloseTo(0.001, 9);
    expect(metersPerUnit('cm')).toBeCloseTo(0.01, 9);
    expect(metersPerUnit('m')).toBe(1);
    expect(metersPerUnit('in')).toBeCloseTo(0.0254, 9);
    expect(metersPerUnit('ft')).toBeCloseTo(0.3048, 9);
  });

  it('treats unitless as 1:1', () => {
    expect(metersPerUnit('unitless')).toBe(1);
  });
});

describe('inferUnitFromBbox', () => {
  it('returns mm for building-scale numeric extents', () => {
    expect(inferUnitFromBbox({ min: [0, 0], max: [12000, 8000] })).toBe('mm');
  });

  it('returns m for small numeric extents', () => {
    expect(inferUnitFromBbox({ min: [0, 0], max: [12, 8] })).toBe('m');
  });

  it('returns cm for mid extents', () => {
    expect(inferUnitFromBbox({ min: [0, 0], max: [800, 500] })).toBe('cm');
  });

  it('returns unitless for null bbox', () => {
    expect(inferUnitFromBbox(null)).toBe('unitless');
  });

  it('returns unitless for degenerate bbox', () => {
    expect(inferUnitFromBbox({ min: [0, 0], max: [0, 0] })).toBe('unitless');
  });
});
