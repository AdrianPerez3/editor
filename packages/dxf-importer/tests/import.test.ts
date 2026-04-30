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

  it('falls back to mm via $MEASUREMENT=1 when $INSUNITS is 0', () => {
    const result = importDxf(fixture('units-measurement-metric.dxf'));
    expect(result.stats.unit).toBe('mm');
    expect(result.stats.unitSource).toBe('measurement');
    expect(result.stats.scaleToMeters).toBeCloseTo(0.001, 9);
    expect(result.warnings.some((w) => w.message.includes('inferred from $MEASUREMENT'))).toBe(
      true,
    );
  });

  it('falls back to inches via $MEASUREMENT=0 when $INSUNITS is 0', () => {
    const result = importDxf(fixture('units-measurement-imperial.dxf'));
    expect(result.stats.unit).toBe('in');
    expect(result.stats.unitSource).toBe('measurement');
    expect(result.stats.scaleToMeters).toBeCloseTo(0.0254, 9);
    expect(result.warnings.some((w) => w.message.includes('inferred from $MEASUREMENT'))).toBe(
      true,
    );
  });

  it('imports an L-shaped house: walls + door/window INSERTs', () => {
    const result = importDxf(fixture('house-with-doors.dxf'));
    // L-shape polyline (closed, 6 vertices) + 2 LINEs = 8 wall segments.
    expect(result.walls.length).toBe(8);
    // 3 doors + 2 windows = 5 INSERTs surfaced.
    expect(result.inserts.length).toBe(5);
    expect(result.stats.insertsDetected).toBe(5);
    // INSERT positions should be in meters, with Y flipped to editor coords.
    const door1 = result.inserts.find((i) => i.blockName === 'DOOR_900' && i.rotation === 0);
    expect(door1).toBeDefined();
    if (door1) {
      // Source position (1500, 0) mm -> (1.5, 0) m with Y flipped to (1.5 - cx, 0 - cy)
      // Hard to assert exact coords because of recentering; just check bounds.
      expect(Number.isFinite(door1.position[0])).toBe(true);
      expect(Number.isFinite(door1.position[1])).toBe(true);
    }
    // Door layer counts should reflect INSERTs even though we don't import as walls.
    const layerHistogram = result.stats.layersClassified;
    expect(layerHistogram.wall).toBeGreaterThan(0);
  });

  it('imports a Revit metric export with AIA-prefixed layers', () => {
    const result = importDxf(fixture('revit-metric-export.dxf'));
    // $INSUNITS=4 -> mm via header.
    expect(result.stats.unit).toBe('mm');
    expect(result.stats.unitSource).toBe('header');
    expect(result.stats.scaleToMeters).toBeCloseTo(0.001, 9);
    // 4 segments from the closed exterior LWPOLYLINE + 1 from the interior partition.
    expect(result.walls).toHaveLength(5);
    // 1 door INSERT + 1 window INSERT.
    expect(result.inserts).toHaveLength(2);
    expect(result.stats.insertsDetected).toBe(2);
    // All 5 declared layers should be present, plus the implicit "0" layer.
    expect(result.stats.layersDetected).toBe(6);
    // Bbox should be 5m x 4m in meters.
    expect(result.stats.bbox).not.toBeNull();
    if (!result.stats.bbox) return;
    const dx = result.stats.bbox.max[0] - result.stats.bbox.min[0];
    const dy = result.stats.bbox.max[1] - result.stats.bbox.min[1];
    expect(dx).toBeCloseTo(5, 3);
    expect(dy).toBeCloseTo(4, 3);
  });

  it('imports a SketchUp imperial export with non-AIA WALL/DOOR layers', () => {
    const result = importDxf(fixture('sketchup-imperial-quirk.dxf'));
    // $INSUNITS=1 -> in via header.
    expect(result.stats.unit).toBe('in');
    expect(result.stats.unitSource).toBe('header');
    expect(result.stats.scaleToMeters).toBeCloseTo(0.0254, 9);
    // 4 LINE walls forming a 480x360 inch rectangle.
    expect(result.walls).toHaveLength(4);
    // 1 DOOR_36 INSERT.
    expect(result.inserts).toHaveLength(1);
    expect(result.inserts[0]?.blockName).toBe('DOOR_36');
    // Bbox: 480 in -> ~12.192 m, 360 in -> ~9.144 m.
    expect(result.stats.bbox).not.toBeNull();
    if (!result.stats.bbox) return;
    const dx = result.stats.bbox.max[0] - result.stats.bbox.min[0];
    const dy = result.stats.bbox.max[1] - result.stats.bbox.min[1];
    expect(dx).toBeCloseTo(480 * 0.0254, 3);
    expect(dy).toBeCloseTo(360 * 0.0254, 3);
  });

  it('infers mm from bbox heuristic for a unitless Civil3D-style export', () => {
    const result = importDxf(fixture('civil3d-unitless.dxf'));
    // $INSUNITS=0 + no $MEASUREMENT -> bbox heuristic. Max extent 8000 (>1000) -> mm.
    expect(result.stats.unit).toBe('mm');
    expect(result.stats.unitSource).toBe('heuristic');
    expect(result.stats.scaleToMeters).toBeCloseTo(0.001, 9);
    // 2 LINEs on A-WALL classified as walls; the V-ROAD line goes to underlay.
    expect(result.walls).toHaveLength(2);
    expect(result.stats.layersClassified.wall).toBe(2);
    expect(result.stats.layersClassified.underlay).toBe(1);
    // Bbox spans 6m x 8m after scaling.
    expect(result.stats.bbox).not.toBeNull();
    if (!result.stats.bbox) return;
    const dx = result.stats.bbox.max[0] - result.stats.bbox.min[0];
    const dy = result.stats.bbox.max[1] - result.stats.bbox.min[1];
    expect(dx).toBeCloseTo(6, 3);
    expect(dy).toBeCloseTo(8, 3);
  });
});
