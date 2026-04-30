import DxfParserModule from 'dxf-parser';

// dxf-parser ships as UMD; under different resolvers `import X from 'dxf-parser'`
// gives either the class directly or `{ default: class }`. Normalize here.
type DxfParserCtor = new () => { parse(text: string): unknown };
const DxfParser: DxfParserCtor =
  typeof DxfParserModule === 'function'
    ? (DxfParserModule as unknown as DxfParserCtor)
    : ((DxfParserModule as unknown as { default: DxfParserCtor }).default);
import { tessellateBulge } from './bulge.js';
import type { ImportWarning, Point2D } from './types.js';

export interface ParsedLayer {
  name: string;
  colorIndex?: number;
  frozen: boolean;
}

export interface ParsedSegment {
  start: Point2D;
  end: Point2D;
  layer: string;
  source: 'LINE' | 'LWPOLYLINE' | 'POLYLINE' | 'ARC' | 'CIRCLE';
}

/**
 * Raw data for an INSERT (block reference) entity. Surfaced by the parser so
 * downstream consumers can place doors, windows, or furniture on walls in a
 * future PR. v1 walls.ts ignores these — it only consumes ParsedSegment[].
 */
export interface ParsedInsert {
  /** Block name being referenced (e.g., "DOOR_36IN", "WIN_DBL"). */
  blockName: string;
  /** Insertion point in source units (DXF X/Y; Z dropped for 2D plans). */
  position: Point2D;
  /** Z elevation of the insertion point in source units (useful for multi-floor). */
  z: number;
  /** Rotation in degrees, CCW from +X (DXF convention). */
  rotation: number;
  /** X scale factor (negative = mirrored). */
  xScale: number;
  /** Y scale factor (negative = mirrored). */
  yScale: number;
  /** Layer the INSERT sits on, used for concept classification. */
  layer: string;
}

export interface ParsedDxf {
  units: number;
  measurement: number | undefined;
  layers: Map<string, ParsedLayer>;
  segments: ParsedSegment[];
  inserts: ParsedInsert[];
  warnings: ImportWarning[];
  raw: unknown;
}

interface RawHeader {
  $INSUNITS?: number;
  $MEASUREMENT?: number;
  [k: string]: unknown;
}

interface RawLayer {
  name: string;
  color?: number;
  frozen?: boolean;
}

interface RawEntityCommon {
  type: string;
  layer?: string;
  paperSpace?: boolean;
}

interface RawLine extends RawEntityCommon {
  type: 'LINE';
  vertices?: Array<{ x: number; y: number; z?: number }>;
  startPoint?: { x: number; y: number; z?: number };
  endPoint?: { x: number; y: number; z?: number };
}

interface RawLwPolyline extends RawEntityCommon {
  type: 'LWPOLYLINE' | 'POLYLINE';
  vertices?: Array<{ x: number; y: number; z?: number; bulge?: number }>;
  shape?: boolean;
  closed?: boolean;
}

interface RawArc extends RawEntityCommon {
  type: 'ARC' | 'CIRCLE';
  center?: { x: number; y: number; z?: number };
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  angleLength?: number;
}

interface RawInsert extends RawEntityCommon {
  type: 'INSERT';
  name?: string;
  position?: { x: number; y: number; z?: number };
  rotation?: number;
  xScale?: number;
  yScale?: number;
}

type RawEntity = RawLine | RawLwPolyline | RawArc | RawInsert | RawEntityCommon;

interface RawDxf {
  header?: RawHeader;
  entities?: RawEntity[];
  blocks?: Record<string, { name?: string; entities?: RawEntity[] } | undefined>;
  tables?: {
    layer?: { layers?: Record<string, RawLayer> };
  };
}

const POINT = (
  v: { x: number; y: number; z?: number } | undefined,
): Point2D | null => (v && Number.isFinite(v.x) && Number.isFinite(v.y) ? [v.x, v.y] : null);

export function parseDxfText(text: string): ParsedDxf {
  const warnings: ImportWarning[] = [];
  let raw: RawDxf;
  try {
    const parser = new DxfParser();
    raw = parser.parse(text) as RawDxf;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      units: 0,
      measurement: undefined,
      layers: new Map(),
      segments: [],
      inserts: [],
      warnings: [{ code: 'parse_error', message }],
      raw: undefined,
    };
  }

  const layers = readLayers(raw);
  const segments: ParsedSegment[] = [];
  const inserts: ParsedInsert[] = [];
  const skippedTypes = new Map<string, number>();
  const frozenLayers = new Set<string>();
  for (const [name, l] of layers) if (l.frozen) frozenLayers.add(name);

  const entities = raw.entities ?? [];
  for (const e of entities) {
    if (e.paperSpace) continue;
    const layer = e.layer ?? '0';
    if (frozenLayers.has(layer)) continue;
    convertEntity(e, layer, segments, inserts, skippedTypes, warnings);
  }

  for (const [type, count] of skippedTypes) {
    warnings.push({
      code: 'unsupported_entity',
      message: `Skipped ${count} entity/entities of type ${type}`,
      entityType: type,
      count,
    });
  }

  return {
    units: raw.header?.$INSUNITS ?? 0,
    measurement: raw.header?.$MEASUREMENT,
    layers,
    segments,
    inserts,
    warnings,
    raw,
  };
}

function readLayers(raw: RawDxf): Map<string, ParsedLayer> {
  const out = new Map<string, ParsedLayer>();
  const tableLayers = raw.tables?.layer?.layers ?? {};
  for (const name of Object.keys(tableLayers)) {
    const l = tableLayers[name];
    if (!l) continue;
    out.set(name, {
      name,
      colorIndex: typeof l.color === 'number' ? l.color : undefined,
      frozen: Boolean(l.frozen),
    });
  }
  // Always include layer "0" — drawings without a layer table still reference it.
  if (!out.has('0')) out.set('0', { name: '0', frozen: false });
  return out;
}

function convertEntity(
  e: RawEntity,
  layer: string,
  segments: ParsedSegment[],
  inserts: ParsedInsert[],
  skippedTypes: Map<string, number>,
  warnings: ImportWarning[],
): void {
  switch (e.type) {
    case 'LINE': {
      const line = e as RawLine;
      // dxf-parser exposes endpoints as either vertices[] or startPoint/endPoint.
      const a = POINT(line.startPoint) ?? POINT(line.vertices?.[0]);
      const b = POINT(line.endPoint) ?? POINT(line.vertices?.[1]);
      if (!a || !b) {
        warnings.push({
          code: 'degenerate_geometry',
          message: 'LINE missing endpoints',
          layer,
          entityType: 'LINE',
        });
        return;
      }
      segments.push({ start: a, end: b, layer, source: 'LINE' });
      return;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const poly = e as RawLwPolyline;
      const verts = poly.vertices ?? [];
      const closed = Boolean(poly.shape ?? poly.closed);
      const points: Point2D[] = [];
      for (let i = 0; i < verts.length; i++) {
        const cur = verts[i];
        if (!cur || !Number.isFinite(cur.x) || !Number.isFinite(cur.y)) continue;
        const next = verts[i + 1] ?? (closed ? verts[0] : undefined);
        if (next && Number.isFinite(next.x) && Number.isFinite(next.y) && cur.bulge && Math.abs(cur.bulge) > 1e-9) {
          // 5mm chord tol; final scale-to-meters happens later, this is in source units
          // so we use a permissive 0.01 here and let the importer pass tolerance through.
          const arcPts = tessellateBulge(
            [cur.x, cur.y],
            [next.x, next.y],
            cur.bulge,
            0.01,
          );
          for (const p of arcPts) points.push(p);
        } else {
          points.push([cur.x, cur.y]);
        }
      }
      const segCount = closed ? points.length : points.length - 1;
      for (let i = 0; i < segCount; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (!a || !b) continue;
        if (a[0] === b[0] && a[1] === b[1]) continue;
        segments.push({ start: a, end: b, layer, source: poly.type });
      }
      return;
    }
    case 'ARC':
    case 'CIRCLE': {
      // We approximate arcs as polyline segments; the v1 walls mapper extrudes
      // each chord into a straight wall. A future v2 should preserve curvature
      // via WallNode.curveOffset.
      // Skip for now; emit underlay-only via a separate arc handler if needed.
      const t = e.type;
      skippedTypes.set(t, (skippedTypes.get(t) ?? 0) + 1);
      return;
    }
    case 'INSERT': {
      const ins = e as RawInsert;
      const pt = POINT(ins.position);
      if (!pt || typeof ins.name !== 'string' || ins.name.length === 0) {
        warnings.push({
          code: 'degenerate_geometry',
          message: 'INSERT missing block name or position',
          layer,
          entityType: 'INSERT',
        });
        return;
      }
      // Skip degenerate scales (collapsed geometry).
      const sx = typeof ins.xScale === 'number' && ins.xScale !== 0 ? ins.xScale : 1;
      const sy = typeof ins.yScale === 'number' && ins.yScale !== 0 ? ins.yScale : 1;
      inserts.push({
        blockName: ins.name,
        position: pt,
        z: typeof ins.position?.z === 'number' && Number.isFinite(ins.position.z) ? ins.position.z : 0,
        rotation: typeof ins.rotation === 'number' && Number.isFinite(ins.rotation) ? ins.rotation : 0,
        xScale: sx,
        yScale: sy,
        layer,
      });
      return;
    }
    default: {
      const t = e.type;
      skippedTypes.set(t, (skippedTypes.get(t) ?? 0) + 1);
      return;
    }
  }
}
