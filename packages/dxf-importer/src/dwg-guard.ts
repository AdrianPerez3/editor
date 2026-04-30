/**
 * DWG (binary AutoCAD) format detection guard.
 *
 * The Pascal editor only supports DXF (interchange) files. Users routinely
 * try to upload DWG (the proprietary binary AutoCAD format), which dxf-parser
 * cannot read. This module sniffs the first bytes of an uploaded file so the
 * UI can render a helpful modal pointing to free conversion tools (e.g. the
 * ODA File Converter) instead of a confusing parse error.
 */

export type FileFormat = 'dxf-ascii' | 'dxf-binary' | 'dwg' | 'unknown';

export interface FormatDetection {
  format: FileFormat;
  /** AutoCAD version code (e.g., "AC1032") if format === 'dwg'. */
  dwgVersion?: string;
  /** Human-readable AutoCAD release name if format === 'dwg' (e.g., "AutoCAD 2018"). */
  dwgRelease?: string;
}

/**
 * Map of DWG version magic strings to human-readable release names.
 * The codes are the first 6 ASCII bytes of every valid DWG file.
 */
const DWG_VERSION_MAP: Record<string, string> = {
  AC1012: 'AutoCAD R13',
  AC1014: 'AutoCAD R14',
  AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007',
  AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013',
  AC1032: 'AutoCAD 2018+',
};

/** 22-byte magic header of a binary DXF file. */
const BINARY_DXF_MAGIC = 'AutoCAD Binary DXF\r\n\x1A\x00';

/** Public guidance message for users who upload a DWG. */
const DWG_GUIDANCE_MESSAGE =
  "DWG (binary AutoCAD) files aren't supported directly yet. " +
  'Convert to DXF first using the free ODA File Converter ' +
  '(https://www.opendesign.com/guestfiles/oda_file_converter), then re-upload.';

/**
 * Decode the first `n` bytes of a binary buffer as ASCII. Bytes outside the
 * printable ASCII range pass through as their raw character codes; this is
 * intentional so the caller can compare against fixed magic strings.
 */
function asciiHead(bytes: Uint8Array, n: number): string {
  const len = Math.min(n, bytes.length);
  let s = '';
  for (let i = 0; i < len; i++) {
    s += String.fromCharCode(bytes[i] as number);
  }
  return s;
}

/**
 * Convert any accepted input form to a head string we can pattern-match.
 * Returns both a short head (first 6 chars, for DWG/DXF magic checks) and a
 * longer head (first 200 chars, for ASCII DXF section sniffing).
 */
function toHeads(
  input: ArrayBuffer | Uint8Array | string,
): { short: string; long: string } {
  if (typeof input === 'string') {
    return { short: input.slice(0, 6), long: input.slice(0, 200) };
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return { short: asciiHead(bytes, 6), long: asciiHead(bytes, 200) };
}

/**
 * Recognize a DWG version code. Valid DWG files begin with "AC" followed by
 * exactly four decimal digits.
 */
function matchDwgVersion(head: string): string | null {
  if (head.length < 6) return null;
  if (head[0] !== 'A' || head[1] !== 'C') return null;
  for (let i = 2; i < 6; i++) {
    const c = head.charCodeAt(i);
    if (c < 48 || c > 57) return null; // not 0-9
  }
  return head.slice(0, 6);
}

/**
 * Heuristic ASCII-DXF detection: after stripping leading whitespace the file
 * must begin with 1-3 decimal digits (a DXF group code) followed by a newline.
 * Real-world DXF group codes range from 0 to 1071, but the leading group is
 * almost always "0" or "999" (comments).
 */
function looksLikeAsciiDxf(long: string): boolean {
  let i = 0;
  while (i < long.length) {
    const c = long.charCodeAt(i);
    if (c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break;
    i++;
  }
  let digits = 0;
  while (i + digits < long.length && digits < 3) {
    const c = long.charCodeAt(i + digits);
    if (c < 48 || c > 57) break;
    digits++;
  }
  if (digits === 0) return false;
  const next = long.charCodeAt(i + digits);
  // group code must be terminated by CR or LF
  if (next !== 0x0a && next !== 0x0d) return false;
  return true;
}

/**
 * Sniff the first bytes of an uploaded file to detect format.
 * Accepts either ArrayBuffer/Uint8Array (binary upload) or string (already-decoded text).
 */
export function detectFileFormat(
  input: ArrayBuffer | Uint8Array | string,
): FormatDetection {
  const { short, long } = toHeads(input);

  // Binary DXF magic must be checked before ASCII heuristics, since the
  // 22-byte preamble is not valid ASCII DXF.
  if (long.startsWith(BINARY_DXF_MAGIC)) {
    return { format: 'dxf-binary' };
  }

  const dwgVersion = matchDwgVersion(short);
  if (dwgVersion !== null) {
    const release = DWG_VERSION_MAP[dwgVersion];
    const detection: FormatDetection = {
      format: 'dwg',
      dwgVersion,
    };
    if (release !== undefined) {
      // Strip the "AutoCAD " prefix from the friendly release map per the
      // public spec: dwgRelease is the trailing token (e.g. "2018+", "R14").
      detection.dwgRelease = release.replace(/^AutoCAD\s+/, '');
    }
    return detection;
  }

  if (looksLikeAsciiDxf(long)) {
    return { format: 'dxf-ascii' };
  }

  return { format: 'unknown' };
}

/**
 * Throw a typed error with a user-friendly message when a DWG is uploaded,
 * so the editor app can render a modal pointing to free conversion tools.
 */
export class UnsupportedDwgError extends Error {
  readonly code = 'unsupported_dwg' as const;
  readonly dwgVersion?: string;
  readonly dwgRelease?: string;

  constructor(detection: FormatDetection) {
    const release = detection.dwgRelease;
    const versionPart =
      release !== undefined
        ? ` (detected ${release})`
        : detection.dwgVersion !== undefined
          ? ` (version code ${detection.dwgVersion})`
          : '';
    super(
      `Unsupported file format: DWG${versionPart}. ${DWG_GUIDANCE_MESSAGE}`,
    );
    this.name = 'UnsupportedDwgError';
    if (detection.dwgVersion !== undefined) {
      this.dwgVersion = detection.dwgVersion;
    }
    if (release !== undefined) {
      this.dwgRelease = release;
    }
    // Maintain a clean prototype chain so `instanceof` works after transpile.
    Object.setPrototypeOf(this, UnsupportedDwgError.prototype);
  }
}

/** Throws UnsupportedDwgError if the input is a DWG. No-op otherwise. */
export function assertNotDwg(
  input: ArrayBuffer | Uint8Array | string,
): void {
  const detection = detectFileFormat(input);
  if (detection.format === 'dwg') {
    throw new UnsupportedDwgError(detection);
  }
}

/** Same as assertNotDwg but returns a structured result instead of throwing. */
export function checkForDwg(
  input: ArrayBuffer | Uint8Array | string,
): { ok: true } | { ok: false; error: UnsupportedDwgError } {
  const detection = detectFileFormat(input);
  if (detection.format === 'dwg') {
    return { ok: false, error: new UnsupportedDwgError(detection) };
  }
  return { ok: true };
}

/** Returns the public guidance message users should see when DWG is rejected. */
export function dwgGuidanceMessage(): string {
  return DWG_GUIDANCE_MESSAGE;
}
