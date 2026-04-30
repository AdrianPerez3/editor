import type { Point2D } from './types.js';

/**
 * Transform a DXF (x, y) into editor level-local (x, z).
 *
 * DXF plan view is right-handed Z-up with Y forward; the Pascal editor uses
 * Y-up with the floor plan in the XZ plane. For 2D plans (z_dxf approx 0),
 * the mapping is (x_dxf, y_dxf) -> (x_dxf, -y_dxf).
 */
export function dxfToLevel(p: Point2D): Point2D {
  // Normalize -0 to 0 so downstream deep-equals don't trip on signed zero.
  const y = -p[1];
  return [p[0], y === 0 ? 0 : y];
}

export function scalePoint(p: Point2D, factor: number): Point2D {
  return [p[0] * factor, p[1] * factor];
}

export function translatePoint(p: Point2D, offset: Point2D): Point2D {
  return [p[0] - offset[0], p[1] - offset[1]];
}

export interface Bbox {
  min: Point2D;
  max: Point2D;
}

export function emptyBbox(): Bbox {
  return {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
}

export function expandBbox(b: Bbox, p: Point2D): void {
  if (p[0] < b.min[0]) b.min[0] = p[0];
  if (p[1] < b.min[1]) b.min[1] = p[1];
  if (p[0] > b.max[0]) b.max[0] = p[0];
  if (p[1] > b.max[1]) b.max[1] = p[1];
}

export function isBboxValid(b: Bbox): boolean {
  return (
    Number.isFinite(b.min[0]) &&
    Number.isFinite(b.min[1]) &&
    Number.isFinite(b.max[0]) &&
    Number.isFinite(b.max[1]) &&
    b.max[0] >= b.min[0] &&
    b.max[1] >= b.min[1]
  );
}

export function bboxCenter(b: Bbox): Point2D {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
}
