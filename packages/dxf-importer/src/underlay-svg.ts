/**
 * SVG generator for the 2D underlay channel of the DXF importer.
 *
 * Consumes the `UnderlayLine[]` produced by `importDxf` and renders a
 * self-contained SVG string the editor app can convert to a data URL and
 * apply as a texture on a `GuideNode` (a textured plane in 3D).
 *
 * Coordinate frame:
 * - Editor space uses (x, z) meters with z growing "up on the floor plane".
 * - SVG y grows downward, so we flip y when emitting line coords.
 * - The SVG's origin (top-left) is anchored at (bbox.min.x, bbox.max.z) in
 *   editor space. Width/height match the bbox extent + padding.
 */
import type { Point2D, UnderlayLine } from './types.js';

export interface UnderlaySvgOptions {
  /** Pixels per meter (default 100). Higher = sharper texture. */
  pixelsPerMeter?: number;
  /** Stroke width in meters (default 0.02 = 20mm at 1:1). */
  strokeMeters?: number;
  /** Hex color for lines when layer color is missing (default '#888'). */
  defaultStrokeColor?: string;
  /** Padding around the bounding box, in meters (default 0.5). */
  paddingMeters?: number;
  /** Per-layer stroke colors. */
  layerColors?: Record<string, string>;
}

export interface UnderlaySvg {
  svg: string; // <svg ...>...</svg> string
  /** Width of the rendered SVG in meters (matches the plane size in 3D). */
  widthMeters: number;
  heightMeters: number;
  /** Top-left corner of the SVG in editor coords, meters. */
  originX: number;
  originY: number;
}

const DEFAULT_PIXELS_PER_METER = 100;
const DEFAULT_STROKE_METERS = 0.02;
const DEFAULT_STROKE_COLOR = '#888';
const DEFAULT_PADDING_METERS = 0.5;

/**
 * Escape XML attribute / text content. Handles the five entities that can
 * break a self-contained SVG.
 */
export function escapeXml(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    switch (ch) {
      case 38 /* & */:
        out += '&amp;';
        break;
      case 60 /* < */:
        out += '&lt;';
        break;
      case 62 /* > */:
        out += '&gt;';
        break;
      case 34 /* " */:
        out += '&quot;';
        break;
      case 39 /* ' */:
        out += '&apos;';
        break;
      default:
        out += value[i];
    }
  }
  return out;
}

function isFinitePoint(p: Point2D): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/**
 * Format a number for SVG output. Trims trailing zeros and caps precision at
 * 4 decimals (sub-millimetre at 1 m units), keeping the SVG compact.
 */
function fmt(n: number): string {
  // Normalise -0 to 0 so snapshots stay deterministic.
  if (n === 0) return '0';
  const rounded = Math.round(n * 10000) / 10000;
  if (rounded === 0) return '0';
  // Avoid scientific notation for tiny numbers (toFixed handles it).
  let s = rounded.toFixed(4);
  // Strip trailing zeros and a possible dangling dot.
  if (s.indexOf('.') !== -1) {
    let end = s.length - 1;
    while (end > 0 && s.charCodeAt(end) === 48 /* '0' */) end--;
    if (s.charCodeAt(end) === 46 /* '.' */) end--;
    s = s.slice(0, end + 1);
  }
  return s;
}

/**
 * Generate a self-contained SVG string from underlay lines.
 *
 * Returns null when `lines` is empty so callers can short-circuit upload of
 * an empty texture.
 */
export function generateUnderlaySvg(
  lines: UnderlayLine[],
  options: UnderlaySvgOptions = {},
): UnderlaySvg | null {
  if (!lines || lines.length === 0) return null;

  const pixelsPerMeter = options.pixelsPerMeter ?? DEFAULT_PIXELS_PER_METER;
  const strokeMeters = options.strokeMeters ?? DEFAULT_STROKE_METERS;
  const defaultStrokeColor =
    options.defaultStrokeColor ?? DEFAULT_STROKE_COLOR;
  const paddingMeters = options.paddingMeters ?? DEFAULT_PADDING_METERS;
  const layerColors = options.layerColors ?? {};

  // Collect valid lines (skip non-finite coordinates silently).
  const valid: UnderlayLine[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const line of lines) {
    if (!isFinitePoint(line.start) || !isFinitePoint(line.end)) continue;
    valid.push(line);
    if (line.start[0] < minX) minX = line.start[0];
    if (line.end[0] < minX) minX = line.end[0];
    if (line.start[0] > maxX) maxX = line.start[0];
    if (line.end[0] > maxX) maxX = line.end[0];
    if (line.start[1] < minY) minY = line.start[1];
    if (line.end[1] < minY) minY = line.end[1];
    if (line.start[1] > maxY) maxY = line.start[1];
    if (line.end[1] > maxY) maxY = line.end[1];
  }

  // All lines were invalid.
  if (valid.length === 0) return null;

  // Apply padding.
  minX -= paddingMeters;
  minY -= paddingMeters;
  maxX += paddingMeters;
  maxY += paddingMeters;

  const widthMeters = Math.max(maxX - minX, strokeMeters);
  const heightMeters = Math.max(maxY - minY, strokeMeters);
  const widthPx = widthMeters * pixelsPerMeter;
  const heightPx = heightMeters * pixelsPerMeter;

  // Group lines by layer for debuggability.
  const byLayer = new Map<string, UnderlayLine[]>();
  for (const line of valid) {
    const list = byLayer.get(line.layer);
    if (list) list.push(line);
    else byLayer.set(line.layer, [line]);
  }

  // SVG y for an editor-space z value. Editor z grows "up on plane",
  // so we mirror it across the bbox: svgY = heightMeters - (z - minY)
  //                                       = (maxY - z)
  const flipY = (z: number): number => maxY - z;

  let body = '';
  for (const [layer, layerLines] of byLayer) {
    if (layerLines.length === 0) continue;
    const first = layerLines[0]!;
    const stroke =
      first.colorHex ?? layerColors[layer] ?? defaultStrokeColor;
    body += `<g data-layer="${escapeXml(layer)}" stroke="${escapeXml(stroke)}" stroke-width="${fmt(strokeMeters)}" stroke-linecap="round">`;
    for (const line of layerLines) {
      // Per-line color override only when explicitly set on the line and
      // it differs from the group stroke.
      const lineStroke = line.colorHex ?? layerColors[line.layer];
      const x1 = line.start[0] - minX;
      const y1 = flipY(line.start[1]);
      const x2 = line.end[0] - minX;
      const y2 = flipY(line.end[1]);
      const overrideAttr =
        lineStroke && lineStroke !== stroke
          ? ` stroke="${escapeXml(lineStroke)}"`
          : '';
      body += `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"${overrideAttr}/>`;
    }
    body += '</g>';
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${fmt(widthPx)}" height="${fmt(heightPx)}" ` +
    `viewBox="0 0 ${fmt(widthMeters)} ${fmt(heightMeters)}">` +
    body +
    `</svg>`;

  return {
    svg,
    widthMeters,
    heightMeters,
    originX: minX,
    // Top-left in editor coords corresponds to the maximum z (because we
    // flipped the axis). Returning maxY makes downstream "place the plane
    // so it overlays the right meters" math straightforward.
    originY: maxY,
  };
}

/**
 * Convert an SVG string to a base64 data URL the browser/three.js can load
 * directly into a texture.
 *
 * Polyfill-friendly: prefers `globalThis.btoa` when present (browsers,
 * modern bun/node 20+), falls back to `Buffer` (node), and finally to a
 * pure-JS encoder. This keeps the function callable in tests under any of
 * those environments.
 */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${encodeBase64(svg)}`;
}

function encodeBase64(input: string): string {
  // Modern global (browsers, node >=16, bun, deno).
  const g: { btoa?: (s: string) => string; Buffer?: typeof Buffer } =
    globalThis as never;
  if (typeof g.btoa === 'function') {
    // btoa expects Latin-1; encode UTF-8 bytes as Latin-1 chars first so
    // SVGs containing non-ASCII layer names round-trip correctly.
    return g.btoa(utf8ToLatin1(input));
  }
  if (g.Buffer) {
    return g.Buffer.from(input, 'utf-8').toString('base64');
  }
  // Last-resort pure-JS encoder.
  return pureBase64(utf8ToLatin1(input));
}

function utf8ToLatin1(s: string): string {
  // Convert a UTF-16 string to its UTF-8 bytes packed back into a Latin-1
  // string, suitable for `btoa`.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) {
      out += s[i];
    } else if (code < 0x800) {
      out += String.fromCharCode(0xc0 | (code >> 6));
      out += String.fromCharCode(0x80 | (code & 0x3f));
    } else if (code < 0xd800 || code >= 0xe000) {
      out += String.fromCharCode(0xe0 | (code >> 12));
      out += String.fromCharCode(0x80 | ((code >> 6) & 0x3f));
      out += String.fromCharCode(0x80 | (code & 0x3f));
    } else {
      // Surrogate pair.
      const hi = code;
      const lo = s.charCodeAt(++i);
      const cp = 0x10000 + (((hi & 0x3ff) << 10) | (lo & 0x3ff));
      out += String.fromCharCode(0xf0 | (cp >> 18));
      out += String.fromCharCode(0x80 | ((cp >> 12) & 0x3f));
      out += String.fromCharCode(0x80 | ((cp >> 6) & 0x3f));
      out += String.fromCharCode(0x80 | (cp & 0x3f));
    }
  }
  return out;
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function pureBase64(latin1: string): string {
  let out = '';
  let i = 0;
  for (; i + 2 < latin1.length; i += 3) {
    const a = latin1.charCodeAt(i);
    const b = latin1.charCodeAt(i + 1);
    const c = latin1.charCodeAt(i + 2);
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 0x03) << 4) | (b >> 4)];
    out += BASE64_ALPHABET[((b & 0x0f) << 2) | (c >> 6)];
    out += BASE64_ALPHABET[c & 0x3f];
  }
  const rem = latin1.length - i;
  if (rem === 1) {
    const a = latin1.charCodeAt(i);
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[(a & 0x03) << 4];
    out += '==';
  } else if (rem === 2) {
    const a = latin1.charCodeAt(i);
    const b = latin1.charCodeAt(i + 1);
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 0x03) << 4) | (b >> 4)];
    out += BASE64_ALPHABET[(b & 0x0f) << 2];
    out += '=';
  }
  return out;
}
