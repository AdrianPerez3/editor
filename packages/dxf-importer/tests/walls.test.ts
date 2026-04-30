import { describe, expect, it } from 'vitest';
import type { ParsedSegment } from '../src/parse.js';
import { DEFAULT_OPTIONS } from '../src/types.js';
import { mapSegmentsToWalls } from '../src/walls.js';

const seg = (layer: string, sx: number, sy: number, ex: number, ey: number): ParsedSegment => ({
  start: [sx, sy],
  end: [ex, ey],
  layer,
  source: 'LINE',
});

describe('mapSegmentsToWalls', () => {
  it('promotes wall-layer segments to WallSpec', () => {
    const segs = [seg('A-WALL', 0, 0, 5000, 0), seg('A-WALL', 5000, 0, 5000, 3000)];
    const r = mapSegmentsToWalls(segs, ['A-WALL'], 0.001, DEFAULT_OPTIONS);
    expect(r.walls).toHaveLength(2);
    const w = r.walls[0];
    if (!w) throw new Error('expected wall');
    expect(w.thickness).toBe(0.1);
    expect(w.height).toBe(2.4);
    expect(w.materialPreset).toBe('preset-white');
    expect(w.sourceLayer).toBe('A-WALL');
  });

  it('flips Y when transforming to editor XZ coords', () => {
    const segs = [seg('A-WALL', 0, 0, 0, 1000)];
    const r = mapSegmentsToWalls(segs, ['A-WALL'], 0.001, {
      ...DEFAULT_OPTIONS,
      recenterToOrigin: false,
    });
    const w = r.walls[0];
    if (!w) throw new Error('expected wall');
    expect(w.start).toEqual([0, 0]);
    expect(w.end[1]).toBeCloseTo(-1, 9);
  });

  it('scales source units to meters', () => {
    const segs = [seg('A-WALL', 0, 0, 4000, 0)];
    const r = mapSegmentsToWalls(segs, ['A-WALL'], 0.001, {
      ...DEFAULT_OPTIONS,
      recenterToOrigin: false,
    });
    const w = r.walls[0];
    if (!w) throw new Error('expected wall');
    expect(w.end[0]).toBeCloseTo(4, 9);
  });

  it('routes non-wall layers to underlay', () => {
    const segs = [
      seg('A-WALL', 0, 0, 1000, 0),
      seg('CUSTOM-NOTES', 0, 0, 100, 100),
    ];
    const r = mapSegmentsToWalls(segs, ['A-WALL', 'CUSTOM-NOTES'], 0.001, DEFAULT_OPTIONS);
    expect(r.walls).toHaveLength(1);
    expect(r.underlay).toHaveLength(1);
  });

  it('drops segments shorter than 5mm after scaling (noise)', () => {
    const segs = [seg('A-WALL', 0, 0, 1, 0)]; // 1mm at scale 0.001 = 0.001m, below 5mm threshold
    const r = mapSegmentsToWalls(segs, ['A-WALL'], 0.001, DEFAULT_OPTIONS);
    expect(r.walls).toHaveLength(0);
  });

  it('skips entirely-ignored layers (DEFPOINTS, dimensions)', () => {
    const segs = [
      seg('A-WALL', 0, 0, 5000, 0),
      seg('A-ANNO-DIMS', 0, 0, 1000, 0),
      seg('DEFPOINTS', 0, 0, 1000, 0),
    ];
    const r = mapSegmentsToWalls(
      segs,
      ['A-WALL', 'A-ANNO-DIMS', 'DEFPOINTS'],
      0.001,
      DEFAULT_OPTIONS,
    );
    expect(r.walls).toHaveLength(1);
    expect(r.underlay).toHaveLength(0);
  });

  it('recenters geometry around origin by default', () => {
    const segs = [
      seg('A-WALL', 100000, 200000, 104000, 200000),
      seg('A-WALL', 104000, 200000, 104000, 203000),
    ];
    const r = mapSegmentsToWalls(segs, ['A-WALL'], 0.001, DEFAULT_OPTIONS);
    const xs = r.walls.flatMap((w) => [w.start[0], w.end[0]]);
    const maxAbs = Math.max(...xs.map((x) => Math.abs(x)));
    // After recentering, no point should be more than half the bbox span (4 m / 2 = 2 m).
    expect(maxAbs).toBeLessThanOrEqual(2.001);
  });
});
