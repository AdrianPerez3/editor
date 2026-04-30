import type { LayerConcept } from './types.js';

interface Rule {
  concept: LayerConcept;
  pattern: RegExp;
}

/**
 * Multilingual layer-name heuristics. Order matters: the first matching rule
 * wins, so more specific patterns (door, window) come before broader ones
 * (wall) where a name fragment could collide.
 *
 * Word-boundary policy: after a recognized prefix we use `(?:[-_]|$)` instead
 * of `\b` so that "WALL" matches "WALL_EXT" or "A-WALL" but not "WALLPAPER".
 */
const RULES: Rule[] = [
  // Japanese SXF codes (per MLIT 建築CAD図面作成要領) — anchor specifically.
  { concept: 'door', pattern: /^D[-_]?BCS[-_]?DOOR(?:[-_]|$)/i },
  { concept: 'window', pattern: /^D[-_]?BCS[-_]?(?:WIND|FNTR)(?:[-_]|$)/i },
  { concept: 'stair', pattern: /^D[-_]?BCS[-_]?STAR(?:[-_]|$)/i },
  { concept: 'wall', pattern: /^D[-_]?BCS[-_]?(?:WALL|PRTN)(?:[-_]|$)/i },

  // Allplan (Nemetschek) prefixed patterns — specific before generic.
  { concept: 'door', pattern: /^AR[-_]?(?:TUER|AUFSCHL)(?:[-_]|$)/i },
  { concept: 'window', pattern: /^AR[-_]?FENST(?:[-_]|$)/i },
  { concept: 'wall', pattern: /^AR[-_]?(?:WAND|AW[-_]?TRAG|AW|IW|MAK)(?:[-_]|$)/i },

  // Chinese (CJK) variants — anchored with ^ only; layer names typically
  // single-character or unsuffixed in CJK conventions.
  { concept: 'door', pattern: /^门/ },
  { concept: 'window', pattern: /^窗/ },
  { concept: 'stair', pattern: /^楼梯/ },
  { concept: 'floor', pattern: /^楼板/ },
  { concept: 'wall', pattern: /^(?:砖墙|砼墙|墙)/ },

  // Doors first (could otherwise match "wall" containing "door")
  { concept: 'door', pattern: /^(?:A[-_]?DOOR|M[-_]?DOORS?|DOORS?|TUER|TUR|PORTE|PUERTA|PORTA|DOA|TOBIRA)(?:[-_]|$)/i },
  // Windows / glazing
  { concept: 'window', pattern: /^(?:A[-_]?GLAZ|A[-_]?WIN|A[-_]?WINDOW|WINDOW|FENSTER|FENETRE|VENTANA|FINESTRA|SERRAMENTI|MADO)(?:[-_]|$)/i },
  // Stairs (specific A-FLOR-STRS before generic FLOR)
  { concept: 'stair', pattern: /^(?:A[-_]?FLOR[-_]?STRS|STAIR|TREPPE|ESCALIER|ESCALERA|SCALA|KAIDAN)(?:[-_]|$)/i },
  // Floors / slabs
  { concept: 'floor', pattern: /^(?:A[-_]?FLOR|FLOOR|BODEN|SOL|PLANCHER|SUELO|PISO|PAVIMENTO|YUKA)(?:[-_]|$)/i },
  // Roof
  { concept: 'roof', pattern: /^(?:A[-_]?ROOF|ROOF|DACH|TOITURE|TOIT|CUBIERTA|TETTO|YANE)(?:[-_]|$)/i },
  // Columns
  { concept: 'column', pattern: /^(?:A[-_]?COLS|COLUMN|STUETZE|STUTZE|POTEAU|PILAR|COLUMNA|PILASTRO|HASHIRA)(?:[-_]|$)/i },
  // Rooms / areas
  { concept: 'room', pattern: /^(?:A[-_]?AREA|ROOM|ZONE|RAUM|PIECE|HABITACION|LOCAL|LOCALE|HEYA|SHITSU)(?:[-_]|$)/i },
  // Annotations / labels
  { concept: 'label', pattern: /^(?:A[-_]?ANNO[-_]?TEXT|A[-_]?AREA[-_]?IDEN|A[-_]?ANNO[-_]?IDEN|TEXT|LABEL|TITLE)(?:[-_]|$)/i },
  // Dimensions
  { concept: 'dimension', pattern: /^(?:A[-_]?ANNO[-_]?DIMS|DIM|DIMENSION|MASS)(?:[-_]|$)/i },
  // Curtain wall + mullion + glazed-partition variants (treated as wall).
  { concept: 'wall', pattern: /^(?:CURTAIN[-_]?WALL|MULLION|TRANSOM|GLAZED[-_]?PARTITION|RIDEAU[-_]?MUR|VITRAIL)(?:[-_]|$)/i },
  // Walls (least specific so doors/windows/stairs are checked first)
  { concept: 'wall', pattern: /^(?:A[-_]?WALL|WALL|WAND|MUR|MURO|PARETE|TRAMEZZO|TRAMEZZI|TABIQUE|CLOISON|KABE)(?:[-_]|$)/i },
];

const HATCH_PATTERN = /(HATCH|FILL|PATT|GRID|SHADE)/i;
const CONSTRUCTION_PATTERN = /^(DEFPOINTS|CONSTR(UCTION)?|REF(ERENCE)?|XREF)/i;

/**
 * Classify a single layer name against the default ruleset, with optional
 * per-import override map (exact-match name -> concept).
 */
export function classifyLayer(
  name: string,
  override?: Record<string, LayerConcept>,
): LayerConcept {
  const trimmed = name.trim();
  if (override && trimmed in override) {
    const ov = override[trimmed];
    if (ov) return ov;
  }
  // Layer "0" is the AutoCAD default; treat as ignore unless user overrides.
  if (trimmed === '0') return 'ignore';
  if (CONSTRUCTION_PATTERN.test(trimmed)) return 'ignore';
  for (const rule of RULES) {
    if (rule.pattern.test(trimmed)) return rule.concept;
  }
  if (HATCH_PATTERN.test(trimmed)) return 'underlay';
  return 'underlay';
}

export function classifyAllLayers(
  names: string[],
  override?: Record<string, LayerConcept>,
): Map<string, LayerConcept> {
  const out = new Map<string, LayerConcept>();
  for (const n of names) {
    out.set(n, classifyLayer(n, override));
  }
  return out;
}
