import { describe, expect, it } from 'vitest';
import { detectFloorsFromZ } from '../src/floors.js';

describe('detectFloorsFromZ', () => {
  it('treats empty input as a single (degenerate) floor', () => {
    const r = detectFloorsFromZ([]);
    expect(r.isSingleFloor).toBe(true);
    expect(r.clusters).toHaveLength(0);
  });

  it('returns single floor when all Z values are flat', () => {
    const r = detectFloorsFromZ([0, 0, 0, 0]);
    expect(r.isSingleFloor).toBe(true);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]?.count).toBe(4);
  });

  it('returns single floor when Z spread is below the flat threshold', () => {
    const r = detectFloorsFromZ([0, 0.05, -0.04, 0.02]);
    expect(r.isSingleFloor).toBe(true);
  });

  it('detects two floors separated by a typical floor gap (3 m)', () => {
    const ground = [0, 0, 0.1, -0.05, 0.2];
    const upper = [3, 3.05, 2.95, 3.1];
    const r = detectFloorsFromZ([...ground, ...upper]);
    expect(r.isSingleFloor).toBe(false);
    expect(r.clusters).toHaveLength(2);
    expect(r.clusters[0]?.count).toBe(ground.length);
    expect(r.clusters[1]?.count).toBe(upper.length);
  });

  it('detects three floors with appropriate gaps', () => {
    const r = detectFloorsFromZ([0, 0.1, 3, 3.05, 6, 6.05]);
    expect(r.isSingleFloor).toBe(false);
    expect(r.clusters).toHaveLength(3);
  });

  it('does NOT split on small jitter even when total spread exceeds flat threshold', () => {
    // Continuous gradient (e.g., a sloped surface) — no gap > 2 m.
    const ramp = Array.from({ length: 50 }, (_, i) => i * 0.1); // 0.0..4.9
    const r = detectFloorsFromZ(ramp);
    expect(r.isSingleFloor).toBe(true);
    expect(r.clusters).toHaveLength(1);
  });

  it('honors a custom floorGapMeters threshold', () => {
    const r = detectFloorsFromZ([0, 1.5, 3], { floorGapMeters: 1 });
    expect(r.isSingleFloor).toBe(false);
    expect(r.clusters).toHaveLength(3);
  });

  it('ignores non-finite values', () => {
    const r = detectFloorsFromZ([0, Number.NaN, 3, Number.POSITIVE_INFINITY]);
    expect(r.clusters.length).toBeGreaterThan(0);
    expect(r.clusters.every((c) => Number.isFinite(c.zMin) && Number.isFinite(c.zMax))).toBe(true);
  });

  it('quantizes floating-point jitter when quantize=true (default)', () => {
    const r = detectFloorsFromZ([0, 0.00000001, 0.00000002]);
    expect(r.isSingleFloor).toBe(true);
    expect(r.clusters).toHaveLength(1);
  });

  it('returns clusters sorted ascending by zMin', () => {
    const r = detectFloorsFromZ([6, 0, 3, 9, 0.1, 3.1, 6.1, 9.1]);
    const ascending = r.clusters.every(
      (c, i) => i === 0 || c.zMin >= (r.clusters[i - 1]?.zMin ?? -Infinity),
    );
    expect(ascending).toBe(true);
  });
});
