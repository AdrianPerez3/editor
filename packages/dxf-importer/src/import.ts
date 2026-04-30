import { dxfToLevel } from './coords.js';
import { parseDxfText } from './parse.js';
import {
  inferUnitFromBbox,
  metersPerUnit,
  unitFromInsunits,
  unitFromMeasurement,
} from './units.js';
import {
  DEFAULT_OPTIONS,
  type DxfUnit,
  type ImportedInsert,
  type ImportOptions,
  type ImportResult,
  type ImportStats,
} from './types.js';
import { mapSegmentsToWalls } from './walls.js';

/**
 * Import a DXF file's text contents. Pure function: parse + classify + map +
 * unit-resolve. The caller is responsible for converting `WallSpec[]` to
 * editor `WallNode` instances and dispatching them via `useScene.createNodes`.
 *
 * Unit resolution priority (highest to lowest):
 *   1. user override (`opts.unitOverride`)
 *   2. `$INSUNITS` header
 *   3. `$MEASUREMENT` fallback (FreeCAD's heuristic) — used when `$INSUNITS`
 *      is 0/missing. 0 = English (inches), 1 = Metric (mm).
 *   4. bbox heuristic (mm/cm/m guess from drawing extents)
 *   5. unitless (1:1) with a warning
 */
export function importDxf(text: string, opts: ImportOptions = {}): ImportResult {
  const options: Required<ImportOptions> = { ...DEFAULT_OPTIONS, ...opts };
  const parsed = parseDxfText(text);

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
      const fromMeasurement = unitFromMeasurement(parsed.measurement);
      if (fromMeasurement !== 'unitless') {
        unit = fromMeasurement;
        unitSource = 'measurement';
        parsed.warnings.push({
          code: 'unit_unspecified',
          message:
            'Unit inferred from $MEASUREMENT (English/Metric flag) since $INSUNITS was 0/missing.',
        });
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
  }

  const scaleToMeters = metersPerUnit(unit);
  const layerNames = Array.from(parsed.layers.keys());
  const mapping = mapSegmentsToWalls(parsed.segments, layerNames, scaleToMeters, options);

  // Convert raw INSERTs into editor coords + meters. We do NOT recenter them
  // (their absolute positions need to stay correlated with raw entity coords;
  // recentering walls already shifts coordinates, so a more sophisticated
  // door/window placement step in a future PR will need to apply the same
  // centering offset captured in mapping.bboxSourceUnits).
  const inserts: ImportedInsert[] = parsed.inserts.map((ins) => {
    const scaled: [number, number] = [ins.position[0] * scaleToMeters, ins.position[1] * scaleToMeters];
    const editorPt = dxfToLevel(scaled);
    return {
      blockName: ins.blockName,
      position: editorPt,
      elevation: ins.z * scaleToMeters,
      rotation: ins.rotation,
      xScale: ins.xScale,
      yScale: ins.yScale,
      layer: ins.layer,
    };
  });

  const stats: ImportStats = {
    totalEntities: parsed.segments.length,
    walls: mapping.walls.length,
    underlayLines: mapping.underlay.length,
    insertsDetected: inserts.length,
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
    inserts,
    warnings: [...parsed.warnings, ...mapping.warnings],
    stats,
  };
}
