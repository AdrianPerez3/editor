export type Point2D = [number, number];

export type LayerConcept =
  | 'wall'
  | 'door'
  | 'window'
  | 'floor'
  | 'roof'
  | 'stair'
  | 'column'
  | 'room'
  | 'label'
  | 'dimension'
  | 'underlay'
  | 'ignore';

export type DxfUnit =
  | 'unitless'
  | 'in'
  | 'ft'
  | 'mi'
  | 'mm'
  | 'cm'
  | 'm'
  | 'km'
  | 'yd'
  | 'dm'
  | 'um';

export interface WallSpec {
  start: Point2D;
  end: Point2D;
  thickness: number;
  height: number;
  materialPreset: string;
  sourceLayer: string;
}

export interface UnderlayLine {
  start: Point2D;
  end: Point2D;
  layer: string;
  colorHex?: string;
}

/**
 * A block-reference (INSERT) extracted from the DXF, surfaced as data so a
 * future PR can place doors/windows/furniture on walls. v1 importDxf does
 * NOT consume these — they are purely informational. Position is in
 * editor coords (Y-flipped) and meters.
 */
export interface ImportedInsert {
  blockName: string;
  /** Insertion point in editor (X, Z) plane, meters. */
  position: Point2D;
  /** Z elevation in meters, useful for multi-floor detection. */
  elevation: number;
  /** Rotation in degrees, CCW from +X. */
  rotation: number;
  xScale: number;
  yScale: number;
  layer: string;
}

export interface ImportWarning {
  code:
    | 'unit_unspecified'
    | 'block_missing'
    | 'block_cycle'
    | 'block_depth_exceeded'
    | 'unsupported_entity'
    | 'degenerate_geometry'
    | 'paperspace_skipped'
    | 'frozen_layer_skipped'
    | 'parse_error';
  message: string;
  layer?: string;
  entityType?: string;
  count?: number;
}

export interface ImportStats {
  totalEntities: number;
  walls: number;
  underlayLines: number;
  insertsDetected: number;
  layersDetected: number;
  layersClassified: Record<LayerConcept, number>;
  unit: DxfUnit;
  unitSource: 'header' | 'measurement' | 'heuristic' | 'user';
  scaleToMeters: number;
  bbox: { min: Point2D; max: Point2D } | null;
}

export interface ImportOptions {
  defaultWallHeight?: number;
  defaultWallThickness?: number;
  defaultMaterialPreset?: string;
  unitOverride?: DxfUnit;
  layerMap?: Record<string, LayerConcept>;
  recenterToOrigin?: boolean;
  arcChordToleranceMm?: number;
  maxBlockDepth?: number;
}

export interface ImportResult {
  walls: WallSpec[];
  underlay: UnderlayLine[];
  inserts: ImportedInsert[];
  warnings: ImportWarning[];
  stats: ImportStats;
}

export const DEFAULT_OPTIONS: Required<ImportOptions> = {
  defaultWallHeight: 2.5,
  defaultWallThickness: 0.1,
  defaultMaterialPreset: 'preset-white',
  unitOverride: 'unitless',
  layerMap: {},
  recenterToOrigin: true,
  arcChordToleranceMm: 5,
  maxBlockDepth: 32,
};
