/**
 * Door/window placement: snaps DXF block-references (INSERTs) onto walls.
 *
 * Pure helpers; the importer pipeline produces WallSpec[] + ImportedInsert[],
 * and this module classifies each insert as a door/window/none and projects
 * it onto the nearest wall to compute a parametric position along that wall.
 *
 * v1 heuristics:
 *   - Layer name takes precedence over block name (more reliable).
 *   - Defaults follow common residential dimensions (door 0.9 x 2.1 m,
 *     window 1.5 x 1.5 m, sill 0.9 m).
 *   - hingesSide is derived from the insert's rotation; downstream code can
 *     refine via geometry inspection later.
 */
import type { ImportedInsert, Point2D, WallSpec } from './types.js';

export interface DoorSpec {
  /** Index into the input walls[] array. */
  wallIndex: number;
  /** Parametric position [0, 1] along the wall, from start to end. */
  positionAlongWall: number;
  /** Width of the opening in meters. */
  width: number;
  /** Height of the opening in meters. */
  height: number;
  hingesSide: 'left' | 'right';
  swingDirection: 'inward' | 'outward';
  sourceBlockName: string;
  sourceLayer: string;
}

export interface WindowSpec {
  /** Index into the input walls[] array. */
  wallIndex: number;
  /** Parametric position [0, 1] along the wall, from start to end. */
  positionAlongWall: number;
  /** Width of the opening in meters. */
  width: number;
  /** Height of the opening in meters. */
  height: number;
  /** Sill height (bottom of window) above floor in meters. */
  sillHeight: number;
  sourceBlockName: string;
  sourceLayer: string;
}

export interface OpeningsResult {
  doors: DoorSpec[];
  windows: WindowSpec[];
  /** Number of inserts that classified as door/window but couldn't be snapped to a wall. */
  unplacedInserts: number;
}

export interface PlaceOpeningsOptions {
  /** Maximum perpendicular distance (in meters) from insert to wall for a snap. Default 0.5. */
  snapTolerance?: number;
  /** Default door width in meters. Default 0.9. */
  defaultDoorWidth?: number;
  /** Default door height in meters. Default 2.1. */
  defaultDoorHeight?: number;
  /** Default window width in meters. Default 1.5. */
  defaultWindowWidth?: number;
  /** Default window height in meters. Default 1.5. */
  defaultWindowHeight?: number;
  /** Default window sill height in meters. Default 0.9. */
  defaultSillHeight?: number;
}

const DEFAULT_SNAP_TOLERANCE = 0.5;
const DEFAULT_DOOR_WIDTH = 0.9;
const DEFAULT_DOOR_HEIGHT = 2.1;
const DEFAULT_WINDOW_WIDTH = 1.5;
const DEFAULT_WINDOW_HEIGHT = 1.5;
const DEFAULT_SILL_HEIGHT = 0.9;

/** Reject parametric positions inside this margin from each wall end (corner buffer). */
const T_MIN = 0.05;
const T_MAX = 0.95;

const DOOR_LAYER_PATTERNS: readonly RegExp[] = [
  /door/i,
  /A-DOOR/i,
  /TUER/i,
  /PORTE/i,
  /PUERTA/i,
];

const WINDOW_LAYER_PATTERNS: readonly RegExp[] = [
  /window/i,
  /A-GLAZ/i,
  /A-WIN/i,
  /FENSTER/i,
  /FENETRE/i,
  /VENTANA/i,
  /SERRAMENTI/i,
];

const DOOR_BLOCK_PATTERN = /DOOR|TUER|PORTE/i;
const WINDOW_BLOCK_PATTERN = /WIN|GLAZ|FENSTER/i;

/**
 * Classify an insert as a door, window, or unrelated entity. The layer name
 * is checked first because layer naming conventions (e.g., AIA A-DOOR) tend
 * to be more reliable than block naming.
 */
export function classifyInsert(blockName: string, layer: string): 'door' | 'window' | null {
  const safeLayer = typeof layer === 'string' ? layer : '';
  const safeBlock = typeof blockName === 'string' ? blockName : '';

  for (const re of DOOR_LAYER_PATTERNS) {
    if (re.test(safeLayer)) return 'door';
  }
  for (const re of WINDOW_LAYER_PATTERNS) {
    if (re.test(safeLayer)) return 'window';
  }

  if (DOOR_BLOCK_PATTERN.test(safeBlock)) return 'door';
  if (WINDOW_BLOCK_PATTERN.test(safeBlock)) return 'window';

  return null;
}

// ---------- 2D vector helpers ----------

function subtract(a: Point2D, b: Point2D): Point2D {
  return [a[0] - b[0], a[1] - b[1]];
}

function dot(a: Point2D, b: Point2D): number {
  return a[0] * b[0] + a[1] * b[1];
}

function length(v: Point2D): number {
  return Math.hypot(v[0], v[1]);
}

interface Projection {
  /** Parametric scalar (no clamp) along the wall. t=0 at start, t=1 at end. */
  t: number;
  /** Perpendicular distance from the point to the (infinite) wall line. */
  perpDist: number;
  /** Length of the wall segment in meters. */
  wallLength: number;
}

function projectPointOntoWall(p: Point2D, wall: WallSpec): Projection | null {
  const v = subtract(wall.end, wall.start);
  const wallLength = length(v);
  if (!Number.isFinite(wallLength) || wallLength <= 0) return null;

  const w = subtract(p, wall.start);
  const projScalar = dot(w, v) / (wallLength * wallLength);
  const t = projScalar;

  // Perpendicular distance: |w - t*v|
  const proj: Point2D = [t * v[0], t * v[1]];
  const perp: Point2D = [w[0] - proj[0], w[1] - proj[1]];
  const perpDist = length(perp);

  if (!Number.isFinite(t) || !Number.isFinite(perpDist)) return null;
  return { t, perpDist, wallLength };
}

/**
 * Map a rotation (degrees, CCW from +X) to a hinge side. Rotations in
 * [0, 180) yield 'left'; [180, 360) yield 'right'. Negative rotations are
 * normalized via mod 360.
 */
function hingesSideFromRotation(rotation: number): 'left' | 'right' {
  if (!Number.isFinite(rotation)) return 'left';
  let r = rotation % 360;
  if (r < 0) r += 360;
  return r < 180 ? 'left' : 'right';
}

function hasFinitePoint(p: Point2D | undefined): p is Point2D {
  return !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/**
 * Snap each door/window insert onto the nearest wall and produce typed
 * DoorSpec / WindowSpec records. Inserts that fail classification are
 * silently skipped; inserts that classify but can't snap are counted
 * via `unplacedInserts`.
 */
export function placeOpenings(
  walls: WallSpec[],
  inserts: ImportedInsert[],
  options: PlaceOpeningsOptions = {},
): OpeningsResult {
  const snapTolerance = options.snapTolerance ?? DEFAULT_SNAP_TOLERANCE;
  const doorWidth = options.defaultDoorWidth ?? DEFAULT_DOOR_WIDTH;
  const doorHeight = options.defaultDoorHeight ?? DEFAULT_DOOR_HEIGHT;
  const windowWidth = options.defaultWindowWidth ?? DEFAULT_WINDOW_WIDTH;
  const windowHeight = options.defaultWindowHeight ?? DEFAULT_WINDOW_HEIGHT;
  const sillHeight = options.defaultSillHeight ?? DEFAULT_SILL_HEIGHT;

  const doors: DoorSpec[] = [];
  const windows: WindowSpec[] = [];
  let unplacedInserts = 0;

  if (!Array.isArray(walls) || !Array.isArray(inserts) || inserts.length === 0) {
    return { doors, windows, unplacedInserts };
  }

  for (const insert of inserts) {
    const kind = classifyInsert(insert.blockName, insert.layer);
    if (!kind) continue;

    if (!hasFinitePoint(insert.position)) {
      unplacedInserts += 1;
      continue;
    }

    let bestWallIndex = -1;
    let bestT = 0;
    let bestDist = Number.POSITIVE_INFINITY;

    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      if (!wall) continue;
      if (!hasFinitePoint(wall.start) || !hasFinitePoint(wall.end)) continue;

      const proj = projectPointOntoWall(insert.position, wall);
      if (!proj) continue; // zero-length / NaN wall

      if (proj.perpDist > snapTolerance) continue;
      if (proj.t < T_MIN || proj.t > T_MAX) continue;

      if (proj.perpDist < bestDist) {
        bestDist = proj.perpDist;
        bestWallIndex = i;
        bestT = proj.t;
      }
    }

    if (bestWallIndex < 0) {
      unplacedInserts += 1;
      continue;
    }

    if (kind === 'door') {
      doors.push({
        wallIndex: bestWallIndex,
        positionAlongWall: bestT,
        width: doorWidth,
        height: doorHeight,
        hingesSide: hingesSideFromRotation(insert.rotation),
        swingDirection: 'inward',
        sourceBlockName: insert.blockName,
        sourceLayer: insert.layer,
      });
    } else {
      windows.push({
        wallIndex: bestWallIndex,
        positionAlongWall: bestT,
        width: windowWidth,
        height: windowHeight,
        sillHeight,
        sourceBlockName: insert.blockName,
        sourceLayer: insert.layer,
      });
    }
  }

  return { doors, windows, unplacedInserts };
}
