import type { DxfUnit, Point2D } from './types.js';

const INSUNITS_TABLE: Record<number, { unit: DxfUnit; toMeters: number }> = {
  0: { unit: 'unitless', toMeters: 1 },
  1: { unit: 'in', toMeters: 0.0254 },
  2: { unit: 'ft', toMeters: 0.3048 },
  3: { unit: 'mi', toMeters: 1609.344 },
  4: { unit: 'mm', toMeters: 0.001 },
  5: { unit: 'cm', toMeters: 0.01 },
  6: { unit: 'm', toMeters: 1 },
  7: { unit: 'km', toMeters: 1000 },
  10: { unit: 'yd', toMeters: 0.9144 },
  14: { unit: 'dm', toMeters: 0.1 },
  13: { unit: 'um', toMeters: 1e-6 },
};

export function unitFromInsunits(code: number | undefined): DxfUnit {
  if (code === undefined) return 'unitless';
  return INSUNITS_TABLE[code]?.unit ?? 'unitless';
}

export function metersPerUnit(unit: DxfUnit): number {
  switch (unit) {
    case 'in':
      return 0.0254;
    case 'ft':
      return 0.3048;
    case 'mi':
      return 1609.344;
    case 'mm':
      return 0.001;
    case 'cm':
      return 0.01;
    case 'm':
      return 1;
    case 'km':
      return 1000;
    case 'yd':
      return 0.9144;
    case 'dm':
      return 0.1;
    case 'um':
      return 1e-6;
    default:
      return 1;
  }
}

/**
 * Heuristic unit detection when $INSUNITS is 0/missing. A typical building
 * floor plan in mm has bbox dimensions in the thousands; in meters, tens.
 */
export function inferUnitFromBbox(bbox: {
  min: Point2D;
  max: Point2D;
} | null): DxfUnit {
  if (!bbox) return 'unitless';
  const dx = bbox.max[0] - bbox.min[0];
  const dy = bbox.max[1] - bbox.min[1];
  const d = Math.max(dx, dy);
  if (!Number.isFinite(d) || d <= 0) return 'unitless';
  if (d > 1000) return 'mm';
  if (d > 100) return 'cm';
  if (d > 1) return 'm';
  return 'unitless';
}
