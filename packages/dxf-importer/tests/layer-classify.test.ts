import { describe, expect, it } from 'vitest';
import { classifyAllLayers, classifyLayer } from '../src/layer-classify.js';

describe('classifyLayer (AIA conventions)', () => {
  it('classifies common AIA layer names', () => {
    expect(classifyLayer('A-WALL')).toBe('wall');
    expect(classifyLayer('A-WALL-EXT')).toBe('wall');
    expect(classifyLayer('A-DOOR')).toBe('door');
    expect(classifyLayer('A-GLAZ')).toBe('window');
    expect(classifyLayer('A-FLOR')).toBe('floor');
    expect(classifyLayer('A-FLOR-STRS')).toBe('stair');
    expect(classifyLayer('A-ROOF')).toBe('roof');
    expect(classifyLayer('A-COLS')).toBe('column');
    expect(classifyLayer('A-AREA')).toBe('room');
    expect(classifyLayer('A-ANNO-TEXT')).toBe('label');
    expect(classifyLayer('A-ANNO-DIMS')).toBe('dimension');
  });

  it('is case-insensitive', () => {
    expect(classifyLayer('a-wall')).toBe('wall');
    expect(classifyLayer('A-Wall')).toBe('wall');
    expect(classifyLayer('a_wall')).toBe('wall');
  });

  it('treats default layer 0 as ignore', () => {
    expect(classifyLayer('0')).toBe('ignore');
  });

  it('treats DEFPOINTS and construction layers as ignore', () => {
    expect(classifyLayer('DEFPOINTS')).toBe('ignore');
    expect(classifyLayer('CONSTRUCTION')).toBe('ignore');
    expect(classifyLayer('XREF-SITE')).toBe('ignore');
  });
});

describe('classifyLayer (multilingual)', () => {
  const cases: Array<[string, string]> = [
    ['Wand', 'wall'],
    ['Mur', 'wall'],
    ['Muro', 'wall'],
    ['Parete', 'wall'],
    ['Kabe', 'wall'],
    ['Tuer', 'door'],
    ['Porte', 'door'],
    ['Puerta', 'door'],
    ['Fenster', 'window'],
    ['Fenetre', 'window'],
    ['Ventana', 'window'],
    ['Treppe', 'stair'],
    ['Escalier', 'stair'],
    ['Boden', 'floor'],
    ['Sol', 'floor'],
    ['Dach', 'roof'],
    ['Toit', 'roof'],
  ];
  for (const [name, expected] of cases) {
    it(`classifies "${name}" as ${expected}`, () => {
      expect(classifyLayer(name)).toBe(expected);
    });
  }
});

describe('classifyLayer (overrides)', () => {
  it('honors per-import override map', () => {
    const map = { CUSTOM_THING: 'wall' as const };
    expect(classifyLayer('CUSTOM_THING', map)).toBe('wall');
  });

  it('falls back to underlay for unknown', () => {
    expect(classifyLayer('VERY_OBSCURE_LAYER_NAME')).toBe('underlay');
  });
});

describe('classifyAllLayers', () => {
  it('returns a map keyed by original name', () => {
    const out = classifyAllLayers(['A-WALL', 'A-DOOR', 'misc']);
    expect(out.get('A-WALL')).toBe('wall');
    expect(out.get('A-DOOR')).toBe('door');
    expect(out.get('misc')).toBe('underlay');
  });
});
