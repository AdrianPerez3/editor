import { describe, expect, it } from 'vitest';
import { tessellateArc, tessellateBulge } from '../src/bulge.js';

describe('tessellateBulge', () => {
  it('returns endpoints for a zero bulge', () => {
    const out = tessellateBulge([0, 0], [10, 0], 0, 0.001);
    expect(out).toEqual([[0, 0], [10, 0]]);
  });

  it('produces a semicircular arc for bulge = 1', () => {
    // DXF: positive bulge = CCW. From (-1,0) CCW to (1,0) sweeps π through
    // (0, -1) at the midpoint (math angles increase counterclockwise).
    const out = tessellateBulge([-1, 0], [1, 0], 1, 0.001);
    const mid = out[Math.floor(out.length / 2)];
    expect(mid).toBeDefined();
    if (!mid) throw new Error('expected midpoint');
    expect(mid[0]).toBeCloseTo(0, 1);
    expect(mid[1]).toBeCloseTo(-1, 1);
  });

  it('flips arc direction for negative bulge', () => {
    // Positive bulge (CCW) from (-1,0) to (1,0) -> bottom (y < 0).
    // Negative bulge (CW)  from (-1,0) to (1,0) -> top    (y > 0).
    const ccw = tessellateBulge([-1, 0], [1, 0], 0.5, 0.001);
    const cw = tessellateBulge([-1, 0], [1, 0], -0.5, 0.001);
    const ccwMid = ccw[Math.floor(ccw.length / 2)];
    const cwMid = cw[Math.floor(cw.length / 2)];
    if (!ccwMid || !cwMid) throw new Error('expected midpoints');
    expect(Math.sign(ccwMid[1])).toBe(-1);
    expect(Math.sign(cwMid[1])).toBe(1);
  });

  it('handles degenerate (coincident) endpoints', () => {
    const out = tessellateBulge([5, 5], [5, 5], 1, 0.001);
    expect(out.length).toBeLessThanOrEqual(1);
  });
});

describe('tessellateArc', () => {
  it('returns at least 2 chord segments for a 90 degree arc', () => {
    const pts = tessellateArc([0, 0], 1, 0, 90, 0.01);
    expect(pts.length).toBeGreaterThanOrEqual(3);
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!first || !last) throw new Error('expected endpoints');
    expect(first[0]).toBeCloseTo(1, 5);
    expect(first[1]).toBeCloseTo(0, 5);
    expect(last[0]).toBeCloseTo(0, 5);
    expect(last[1]).toBeCloseTo(1, 5);
  });

  it('returns empty array for non-positive radius', () => {
    expect(tessellateArc([0, 0], 0, 0, 90, 0.01)).toEqual([]);
    expect(tessellateArc([0, 0], -1, 0, 90, 0.01)).toEqual([]);
  });
});
