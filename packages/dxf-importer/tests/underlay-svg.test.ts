import { describe, expect, it } from 'vitest';
import {
  escapeXml,
  generateUnderlaySvg,
  svgToDataUrl,
  type UnderlaySvgOptions,
} from '../src/underlay-svg.js';
import type { UnderlayLine } from '../src/types.js';

function line(
  start: [number, number],
  end: [number, number],
  layer = 'wall',
  colorHex?: string,
): UnderlayLine {
  return colorHex
    ? { start, end, layer, colorHex }
    : { start, end, layer };
}

describe('generateUnderlaySvg', () => {
  it('returns null for empty input', () => {
    expect(generateUnderlaySvg([])).toBeNull();
  });

  it('returns null when all lines have non-finite coordinates', () => {
    const out = generateUnderlaySvg([
      line([NaN, 0], [1, 1]),
      line([0, 0], [Infinity, 1]),
    ]);
    expect(out).toBeNull();
  });

  it('produces a non-empty svg string with <svg and <line for one line', () => {
    const out = generateUnderlaySvg([line([0, 0], [1, 0])]);
    expect(out).not.toBeNull();
    expect(out!.svg).toContain('<svg');
    expect(out!.svg).toContain('</svg>');
    expect(out!.svg).toContain('<line');
    expect(out!.svg.length).toBeGreaterThan(50);
  });

  it('bbox dimensions reflect line extent + padding', () => {
    const out = generateUnderlaySvg([line([0, 0], [3, 4])], {
      paddingMeters: 0.5,
    });
    expect(out).not.toBeNull();
    expect(out!.widthMeters).toBeCloseTo(3 + 1, 6); // 3 + 2 * 0.5
    expect(out!.heightMeters).toBeCloseTo(4 + 1, 6);
    expect(out!.originX).toBeCloseTo(-0.5, 6);
    // originY is the top edge in editor coords (max z + padding).
    expect(out!.originY).toBeCloseTo(4 + 0.5, 6);
  });

  it('honours pixelsPerMeter for the SVG width/height attributes', () => {
    const out = generateUnderlaySvg([line([0, 0], [2, 1])], {
      paddingMeters: 0,
      pixelsPerMeter: 200,
    });
    expect(out).not.toBeNull();
    // 2m wide * 200px/m = 400px, 1m tall * 200 = 200px.
    expect(out!.svg).toMatch(/width="400"/);
    expect(out!.svg).toMatch(/height="200"/);
    expect(out!.svg).toMatch(/viewBox="0 0 2 1"/);
  });

  it('per-layer colors honored when supplied', () => {
    const opts: UnderlaySvgOptions = {
      layerColors: { wall: '#ff0000', door: '#00ff00' },
      paddingMeters: 0,
    };
    const out = generateUnderlaySvg(
      [
        line([0, 0], [1, 0], 'wall'),
        line([0, 1], [1, 1], 'door'),
      ],
      opts,
    );
    expect(out).not.toBeNull();
    expect(out!.svg).toContain('data-layer="wall"');
    expect(out!.svg).toContain('data-layer="door"');
    expect(out!.svg).toContain('#ff0000');
    expect(out!.svg).toContain('#00ff00');
  });

  it('uses defaultStrokeColor when layer is not in colorMap', () => {
    const out = generateUnderlaySvg(
      [line([0, 0], [1, 0], 'unknown-layer')],
      { defaultStrokeColor: '#abcdef', paddingMeters: 0 },
    );
    expect(out).not.toBeNull();
    expect(out!.svg).toContain('#abcdef');
  });

  it('prefers per-line colorHex over layerColors and defaults', () => {
    const out = generateUnderlaySvg(
      [line([0, 0], [1, 0], 'wall', '#123456')],
      {
        defaultStrokeColor: '#000',
        layerColors: { wall: '#999' },
        paddingMeters: 0,
      },
    );
    expect(out).not.toBeNull();
    expect(out!.svg).toContain('#123456');
    expect(out!.svg).not.toContain('#999');
  });

  it('flips Y axis: editor (0, 1) renders above editor (0, 0) in SVG y', () => {
    const out = generateUnderlaySvg(
      [
        line([0, 0], [0, 0], 'a'), // degenerate "point" at editor (0, 0)
        line([0, 1], [0, 1], 'b'), // point at editor (0, 1)
      ],
      { paddingMeters: 0 },
    );
    expect(out).not.toBeNull();
    // Editor z=1 (higher up) should map to a smaller SVG y than editor z=0.
    const yMatches = [...out!.svg.matchAll(/y1="([-0-9.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    // Two lines => two y1s. The line whose source z was 1 must be smaller.
    expect(yMatches).toHaveLength(2);
    const yForZ1 = Math.min(...yMatches);
    const yForZ0 = Math.max(...yMatches);
    expect(yForZ1).toBeLessThan(yForZ0);
    // Total bbox height is 1m, so the difference should equal 1.
    expect(yForZ0 - yForZ1).toBeCloseTo(1, 6);
  });

  it('groups lines by layer with <g data-layer="...">', () => {
    const out = generateUnderlaySvg([
      line([0, 0], [1, 0], 'wall'),
      line([0, 1], [1, 1], 'door'),
    ]);
    expect(out).not.toBeNull();
    expect(out!.svg).toMatch(/<g data-layer="wall"/);
    expect(out!.svg).toMatch(/<g data-layer="door"/);
  });

  it('handles a single line without throwing', () => {
    const out = generateUnderlaySvg([line([5, 5], [6, 6])]);
    expect(out).not.toBeNull();
    expect(out!.svg).toContain('<line');
  });

  it('skips invalid coords silently and still produces SVG for valid ones', () => {
    const out = generateUnderlaySvg([
      line([NaN, 0], [1, 0]),
      line([0, 0], [1, 1]),
    ]);
    expect(out).not.toBeNull();
    // Only one valid line => one <line ...
    const lineCount = (out!.svg.match(/<line /g) ?? []).length;
    expect(lineCount).toBe(1);
  });

  it('escapes layer names with quote characters without breaking XML', () => {
    const naughty = 'layer "with quotes" & <tag>';
    const out = generateUnderlaySvg([line([0, 0], [1, 0], naughty)]);
    expect(out).not.toBeNull();
    // The original raw quote/ampersand/lt/gt must NOT appear inside the
    // data-layer attribute value.
    expect(out!.svg).toContain('data-layer="layer &quot;with quotes&quot; &amp; &lt;tag&gt;"');
    expect(out!.svg).not.toContain('data-layer="layer "with');
  });
});

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
  });

  it('returns the input unchanged when no special chars are present', () => {
    expect(escapeXml('plain-text 123')).toBe('plain-text 123');
  });
});

describe('svgToDataUrl', () => {
  it('returns a string starting with the svg+xml mime prefix', () => {
    const url = svgToDataUrl('<svg/>');
    expect(typeof url).toBe('string');
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('round-trips ASCII content via base64', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const url = svgToDataUrl(svg);
    const b64 = url.slice('data:image/svg+xml;base64,'.length);
    expect(b64.length).toBeGreaterThan(0);
    // Decode and confirm we get the original bytes back.
    const decoded = Buffer.from(b64, 'base64').toString('utf-8');
    expect(decoded).toBe(svg);
  });
});
