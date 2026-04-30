import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertNotDwg,
  checkForDwg,
  detectFileFormat,
  dwgGuidanceMessage,
  UnsupportedDwgError,
} from '../src/dwg-guard.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

describe('detectFileFormat', () => {
  it('recognizes "AC1032..." string as dwg version "AC1032" / release "2018+"', () => {
    const result = detectFileFormat('AC1032\x00\x00\x00\x00rest of the file');
    expect(result.format).toBe('dwg');
    expect(result.dwgVersion).toBe('AC1032');
    expect(result.dwgRelease).toBe('2018+');
  });

  it('recognizes "AC1015..." string as dwg version "AC1015" / release "2000"', () => {
    const result = detectFileFormat('AC1015\x00\x00\x00\x00rest of the file');
    expect(result.format).toBe('dwg');
    expect(result.dwgVersion).toBe('AC1015');
    expect(result.dwgRelease).toBe('2000');
  });

  it('recognizes Uint8Array starting with [0x41,0x43,0x31,0x30,0x33,0x32] as dwg', () => {
    const bytes = new Uint8Array([
      0x41, 0x43, 0x31, 0x30, 0x33, 0x32, 0x00, 0x00, 0x00, 0x00,
    ]);
    const result = detectFileFormat(bytes);
    expect(result.format).toBe('dwg');
    expect(result.dwgVersion).toBe('AC1032');
    expect(result.dwgRelease).toBe('2018+');
  });

  it('recognizes the existing ASCII DXF fixture as "dxf-ascii"', () => {
    const text = fixture('single-line.dxf');
    const result = detectFileFormat(text);
    expect(result.format).toBe('dxf-ascii');
    expect(result.dwgVersion).toBeUndefined();
  });

  it('recognizes the binary DXF magic header bytes as "dxf-binary"', () => {
    const magic = 'AutoCAD Binary DXF\r\n\x1A\x00';
    const bytes = new Uint8Array(magic.length + 8);
    for (let i = 0; i < magic.length; i++) {
      bytes[i] = magic.charCodeAt(i);
    }
    const result = detectFileFormat(bytes);
    expect(result.format).toBe('dxf-binary');
  });

  it('returns "unknown" for non-CAD inputs (PDF, HTML, empty)', () => {
    expect(detectFileFormat('%PDF-1.7\n%binary garbage').format).toBe('unknown');
    expect(detectFileFormat('<!DOCTYPE html>').format).toBe('unknown');
    expect(detectFileFormat('').format).toBe('unknown');
    expect(detectFileFormat(new Uint8Array(0)).format).toBe('unknown');
  });
});

describe('assertNotDwg', () => {
  it('throws UnsupportedDwgError for "AC1032..." input', () => {
    expect(() => assertNotDwg('AC1032\x00\x00\x00\x00')).toThrow(UnsupportedDwgError);
  });

  it('does not throw for ASCII DXF input', () => {
    const text = fixture('single-line.dxf');
    expect(() => assertNotDwg(text)).not.toThrow();
  });

  it('does not throw for unknown input', () => {
    expect(() => assertNotDwg('%PDF-1.7')).not.toThrow();
  });
});

describe('checkForDwg', () => {
  it('returns ok=true for ASCII DXF input', () => {
    const text = fixture('single-line.dxf');
    const result = checkForDwg(text);
    expect(result.ok).toBe(true);
  });

  it('returns ok=false with structured UnsupportedDwgError for DWG input', () => {
    const result = checkForDwg('AC1027\x00\x00\x00\x00');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected ok=false');
    expect(result.error).toBeInstanceOf(UnsupportedDwgError);
    expect(result.error.dwgVersion).toBe('AC1027');
    expect(result.error.dwgRelease).toBe('2013');
    expect(result.error.code).toBe('unsupported_dwg');
  });
});

describe('dwgGuidanceMessage', () => {
  it('includes "ODA File Converter" and a URL', () => {
    const msg = dwgGuidanceMessage();
    expect(msg).toContain('ODA File Converter');
    expect(msg).toMatch(/https?:\/\//);
  });

  it('is deterministic / pure (returns the same string each call)', () => {
    expect(dwgGuidanceMessage()).toBe(dwgGuidanceMessage());
  });
});

describe('UnsupportedDwgError', () => {
  it('thrown error is instanceof UnsupportedDwgError, has code and dwgVersion set', () => {
    let caught: unknown = null;
    try {
      assertNotDwg('AC1018\x00\x00\x00\x00');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnsupportedDwgError);
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof UnsupportedDwgError)) {
      throw new Error('expected UnsupportedDwgError');
    }
    expect(caught.code).toBe('unsupported_dwg');
    expect(caught.dwgVersion).toBe('AC1018');
    expect(caught.dwgRelease).toBe('2004');
    expect(caught.message).toContain('DWG');
  });

  it('error includes the guidance message body', () => {
    const result = checkForDwg('AC1032\x00\x00\x00\x00');
    if (result.ok) throw new Error('expected ok=false');
    expect(result.error.message).toContain('ODA File Converter');
  });
});
