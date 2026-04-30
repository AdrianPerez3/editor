import type { Point2D } from './types.js';

/**
 * Convert a DXF bulge factor between two polyline vertices into a circular arc
 * and tessellate to chord segments. bulge = tan(theta/4) where theta is the
 * signed included sweep angle (positive = CCW). bulge = 0 indicates a straight
 * segment; the caller should short-circuit before invoking this.
 */
export function tessellateBulge(
  p1: Point2D,
  p2: Point2D,
  bulge: number,
  chordToleranceMeters: number,
): Point2D[] {
  if (Math.abs(bulge) < 1e-9) {
    return [p1, p2];
  }

  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) {
    return [p1];
  }

  const theta = 4 * Math.atan(bulge);
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const sagitta = (chord / 2) * Math.abs(bulge);

  const midx = (p1[0] + p2[0]) / 2;
  const midy = (p1[1] + p2[1]) / 2;

  // Perpendicular unit vector to chord (rotated 90 degrees CCW from chord dir).
  const nx = -dy / chord;
  const ny = dx / chord;

  // Center is offset from chord midpoint by (radius - sagitta) along ±n,
  // depending on bulge sign.
  const offset = radius - sagitta;
  const sign = bulge >= 0 ? 1 : -1;
  const cx = midx + sign * nx * offset;
  const cy = midy + sign * ny * offset;

  const startAngle = Math.atan2(p1[1] - cy, p1[0] - cx);

  const safeTol = Math.max(chordToleranceMeters, 1e-6);
  const stepArg = Math.max(-1, Math.min(1, 1 - safeTol / radius));
  const dAlpha = 2 * Math.acos(stepArg);
  const segments = Math.max(2, Math.ceil(Math.abs(theta) / dAlpha));

  const out: Point2D[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + (theta * i) / segments;
    out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return out;
}

/**
 * Tessellate a circular ARC entity (center, radius, start/end angles in DXF
 * convention: degrees, CCW from +X).
 */
export function tessellateArc(
  center: Point2D,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  chordToleranceMeters: number,
): Point2D[] {
  if (radius <= 0) return [];
  let sweep = (endAngleDeg - startAngleDeg) * (Math.PI / 180);
  if (sweep <= 0) sweep += 2 * Math.PI;

  const safeTol = Math.max(chordToleranceMeters, 1e-6);
  const stepArg = Math.max(-1, Math.min(1, 1 - safeTol / radius));
  const dAlpha = 2 * Math.acos(stepArg);
  const segments = Math.max(2, Math.ceil(sweep / dAlpha));

  const start = startAngleDeg * (Math.PI / 180);
  const out: Point2D[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = start + (sweep * i) / segments;
    out.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]);
  }
  return out;
}
