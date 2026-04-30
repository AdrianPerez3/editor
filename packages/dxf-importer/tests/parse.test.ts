import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDxfText } from '../src/parse.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

describe('parseDxfText', () => {
  it('parses a single LINE entity', () => {
    const result = parseDxfText(fixture('single-line.dxf'));
    expect(result.warnings.filter((w) => w.code === 'parse_error')).toHaveLength(0);
    expect(result.units).toBe(4);
    expect(result.layers.has('A-WALL')).toBe(true);
    expect(result.segments).toHaveLength(1);
    const seg = result.segments[0];
    if (!seg) throw new Error('expected segment');
    expect(seg.layer).toBe('A-WALL');
    expect(seg.source).toBe('LINE');
    expect(seg.start).toEqual([0, 0]);
    expect(seg.end).toEqual([5000, 0]);
  });

  it('explodes a closed LWPOLYLINE into 4 segments', () => {
    const result = parseDxfText(fixture('rect-room.dxf'));
    expect(result.segments.length).toBe(4);
    const layers = new Set(result.segments.map((s) => s.layer));
    expect(layers.has('A-WALL')).toBe(true);
  });

  it('preserves layer info across multiple entities', () => {
    const result = parseDxfText(fixture('multi-layer.dxf'));
    expect(result.layers.size).toBeGreaterThanOrEqual(4);
    const byLayer = new Map<string, number>();
    for (const s of result.segments) {
      byLayer.set(s.layer, (byLayer.get(s.layer) ?? 0) + 1);
    }
    expect(byLayer.get('A-WALL')).toBe(2);
    expect(byLayer.get('A-DOOR')).toBe(1);
    expect(byLayer.get('A-ANNO-TEXT')).toBe(1);
    expect(byLayer.get('DEFPOINTS')).toBe(1);
  });

  it('parses an empty file without crashing', () => {
    const result = parseDxfText(fixture('empty.dxf'));
    expect(result.segments).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === 'parse_error')).toBe(false);
  });

  it('reports parse error for clearly malformed content', () => {
    const result = parseDxfText('this is definitely not a DXF file');
    expect(result.warnings.some((w) => w.code === 'parse_error')).toBe(true);
    expect(result.segments).toHaveLength(0);
  });
});
