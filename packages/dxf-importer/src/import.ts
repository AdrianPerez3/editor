import { parseDxfText } from './parse.js';
import { inferUnitFromBbox, metersPerUnit, unitFromInsunits } from './units.js';
import {
  DEFAULT_OPTIONS,
  type DxfUnit,
  type ImportOptions,
  type ImportResult,
  type ImportStats,
} from './types.js';
import { mapSegmentsToWalls } from './walls.js';

/**
 * Import a DXF file's text contents. Pure function: parse + classify + map +
 * unit-resolve. The caller is responsible for converting `WallSpec[]` to
 * editor `WallNode` instances and dispatching them via `useScene.createNodes`.
 */
export function importDxf(text: string, opts: ImportOptions = {}): ImportResult {
  const options: Required<ImportOptions> = { ...DEFAULT_OPTIONS, ...opts };
  const parsed = parseDxfText(text);

  // Resolve units. Priority: explicit override > $INSUNITS header > bbox heuristic.
  let unit: DxfUnit;
  let unitSource: ImportStats['unitSource'];
  if (opts.unitOverride && opts.unitOverride !== 'unitless') {
    unit = opts.unitOverride;
    unitSource = 'user';
  } else {
    const fromHeader = unitFromInsunits(parsed.units);
    if (fromHeader !== 'unitless') {
      unit = fromHeader;
      unitSource = 'header';
    } else {
      // Compute bbox in source units, then guess.
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const s of parsed.segments) {
        if (s.start[0] < minX) minX = s.start[0];
        if (s.start[1] < minY) minY = s.start[1];
        if (s.end[0] > maxX) maxX = s.end[0];
        if (s.end[1] > maxY) maxY = s.end[1];
      }
      const bbox =
        Number.isFinite(minX) && Number.isFinite(maxX)
          ? { min: [minX, minY] as [number, number], max: [maxX, maxY] as [number, number] }
          : null;
      const inferred = inferUnitFromBbox(bbox);
      unit = inferred;
      unitSource = inferred === 'unitless' ? 'header' : 'heuristic';
      if (inferred === 'unitless') {
        parsed.warnings.push({
          code: 'unit_unspecified',
          message:
            'DXF $INSUNITS is 0/missing and bounding box is empty; assuming unitless (1:1).',
        });
      }
    }
  }

  const scaleToMeters = metersPerUnit(unit);
  const layerNames = Array.from(parsed.layers.keys());
  const mapping = mapSegmentsToWalls(parsed.segments, layerNames, scaleToMeters, options);

  const stats: ImportStats = {
    totalEntities: parsed.segments.length,
    walls: mapping.walls.length,
    underlayLines: mapping.underlay.length,
    layersDetected: parsed.layers.size,
    layersClassified: mapping.layersClassified,
    unit,
    unitSource,
    scaleToMeters,
    bbox: mapping.bboxSourceUnits
      ? {
          min: [
            mapping.bboxSourceUnits.min[0] * scaleToMeters,
            mapping.bboxSourceUnits.min[1] * scaleToMeters,
          ],
          max: [
            mapping.bboxSourceUnits.max[0] * scaleToMeters,
            mapping.bboxSourceUnits.max[1] * scaleToMeters,
          ],
        }
      : null,
  };

  return {
    walls: mapping.walls,
    underlay: mapping.underlay,
    warnings: [...parsed.warnings, ...mapping.warnings],
    stats,
  };
}
