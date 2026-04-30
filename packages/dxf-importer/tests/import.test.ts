import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importDxf } from '../src/import.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

describe('importDxf (end-to-end)', () => {
  it('imports a single-line DXF as a 5m wall in mm', () => {
    const result = importDxf(fixture('single-line.dxf'));
    expect(result.stats.unit).toBe('mm');
    expect(result.stats.unitSource).toBe('header');
    expect(result.stats.scaleToMeters).toBeCloseTo(0.001, 9);
    expect(result.walls).toHaveLength(1);
    const w = result.walls[0];
    if (!w) throw new Error('expected wall');
    const length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
    expect(length).toBeCloseTo(5, 3);
  });

  it('imports a rectangular room as 4 wall segments', () => {
    const result = importDxf(fixture('rect-room.dxf'));
    expect(result.walls).toHaveLength(4);
    // Total perimeter should be 2 * (4m + 3m) = 14m.
    const perimeter = result.walls.reduce(
      (sum, w) => sum + Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]),
      0,
    );
    expect(perimeter).toBeCloseTo(14, 3);
  });

  it('separates walls, doors-as-underlay, and ignored entities by layer', () => {
    const result = importDxf(fixture('multi-layer.dxf'));
    // 2 walls on A-WALL; A-DOOR (not yet a Door domain object) goes to underlay;
    // A-ANNO-TEXT and DEFPOINTS are ignored.
    expect(result.walls).toHaveLength(2);
    expect(result.stats.layersClassified.wall).toBe(2);
    expect(result.stats.layersClassified.door).toBe(1);
    expect(result.stats.layersClassified.label).toBe(1);
    expect(result.stats.layersClassified.ignore).toBe(1);
  });

  it('respects user unit override', () => {
    const result = importDxf(fixture('units-meters.dxf'), { unitOverride: 'm' });
    expect(result.stats.unit).toBe('m');
    expect(result.stats.scaleToMeters).toBe(1);
    expect(result.walls).toHaveLength(2);
  });

  it('handles empty file without error', () => {
    const result = importDxf(fixture('empty.dxf'));
    expect(result.walls).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === 'parse_error')).toBe(false);
  });

  it('reports parse error for garbage input', () => {
    const result = importDxf('random text');
    expect(result.walls).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === 'parse_error')).toBe(true);
  });

  it('produces a stats.bbox in meters', () => {
    const result = importDxf(fixture('rect-room.dxf'));
    expect(result.stats.bbox).not.toBeNull();
    if (!result.stats.bbox) return;
    const dx = result.stats.bbox.max[0] - result.stats.bbox.min[0];
    const dy = result.stats.bbox.max[1] - result.stats.bbox.min[1];
    expect(dx).toBeCloseTo(4, 3);
    expect(dy).toBeCloseTo(3, 3);
  });
});
