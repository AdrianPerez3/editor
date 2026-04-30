import {
  bboxCenter,
  dxfToLevel,
  emptyBbox,
  expandBbox,
  isBboxValid,
  scalePoint,
  translatePoint,
} from './coords.js';
import { classifyAllLayers } from './layer-classify.js';
import type { ParsedSegment } from './parse.js';
import type {
  ImportOptions,
  ImportWarning,
  LayerConcept,
  Point2D,
  UnderlayLine,
  WallSpec,
} from './types.js';

export interface WallMappingResult {
  walls: WallSpec[];
  underlay: UnderlayLine[];
  layersClassified: Record<LayerConcept, number>;
  warnings: ImportWarning[];
  bboxSourceUnits: { min: Point2D; max: Point2D } | null;
}

const MIN_SEGMENT_LENGTH_M = 0.005; // 5mm — discard noise after scaling.

/**
 * Map parsed DXF segments to the editor domain (WallSpec[] + underlay lines).
 * All inputs are still in DXF source units; the caller passes scaleToMeters.
 *
 * The transform pipeline per point:
 *   raw (x_dxf, y_dxf)
 *   -> scale by `scaleToMeters`            (units handled)
 *   -> recenter to origin if requested     (translate by bbox center)
 *   -> dxfToLevel (x, -y)                  (axis swap to editor XZ)
 */
export function mapSegmentsToWalls(
  segments: ParsedSegment[],
  layerNames: string[],
  scaleToMeters: number,
  options: Required<ImportOptions>,
): WallMappingResult {
  const layers = classifyAllLayers(layerNames, options.layerMap);
  const counts: Record<LayerConcept, number> = {
    wall: 0,
    door: 0,
    window: 0,
    floor: 0,
    roof: 0,
    stair: 0,
    column: 0,
    room: 0,
    label: 0,
    dimension: 0,
    underlay: 0,
    ignore: 0,
  };

  const bbox = emptyBbox();
  for (const s of segments) {
    expandBbox(bbox, s.start);
    expandBbox(bbox, s.end);
  }
  const validBbox = isBboxValid(bbox);
  const center = validBbox && options.recenterToOrigin ? bboxCenter(bbox) : ([0, 0] as Point2D);

  const walls: WallSpec[] = [];
  const underlay: UnderlayLine[] = [];
  const warnings: ImportWarning[] = [];

  const transform = (p: Point2D): Point2D => {
    const scaled = scalePoint(p, scaleToMeters);
    const centered = options.recenterToOrigin
      ? translatePoint(scaled, [center[0] * scaleToMeters, center[1] * scaleToMeters])
      : scaled;
    return dxfToLevel(centered);
  };

  for (const seg of segments) {
    const layer = seg.layer;
    const concept = layers.get(layer) ?? 'underlay';
    counts[concept] += 1;

    if (concept === 'ignore' || concept === 'dimension' || concept === 'label') {
      continue;
    }

    const start = transform(seg.start);
    const end = transform(seg.end);
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length < MIN_SEGMENT_LENGTH_M) continue;

    if (concept === 'wall' || concept === 'column') {
      walls.push({
        start,
        end,
        thickness: options.defaultWallThickness,
        height: options.defaultWallHeight,
        materialPreset: options.defaultMaterialPreset,
        sourceLayer: layer,
      });
    } else {
      underlay.push({ start, end, layer });
    }
  }

  return {
    walls,
    underlay,
    layersClassified: counts,
    warnings,
    bboxSourceUnits: validBbox ? { min: [bbox.min[0], bbox.min[1]], max: [bbox.max[0], bbox.max[1]] } : null,
  };
}
