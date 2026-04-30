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

describe('classifyLayer (Italian variants)', () => {
  it('classifies TRAMEZZO/TRAMEZZI as wall', () => {
    expect(classifyLayer('TRAMEZZO')).toBe('wall');
    expect(classifyLayer('TRAMEZZI')).toBe('wall');
    expect(classifyLayer('Tramezzo')).toBe('wall');
  });
  it('classifies SERRAMENTI as window', () => {
    expect(classifyLayer('SERRAMENTI')).toBe('window');
    expect(classifyLayer('Serramenti')).toBe('window');
  });
});

describe('classifyLayer (Chinese / CJK variants)', () => {
  it('classifies wall characters', () => {
    expect(classifyLayer('墙')).toBe('wall');
    expect(classifyLayer('砖墙')).toBe('wall');
    expect(classifyLayer('砼墙')).toBe('wall');
  });
  it('classifies door / window characters', () => {
    expect(classifyLayer('门')).toBe('door');
    expect(classifyLayer('窗')).toBe('window');
  });
  it('classifies floor / stair characters', () => {
    expect(classifyLayer('楼板')).toBe('floor');
    expect(classifyLayer('楼梯')).toBe('stair');
  });
});

describe('classifyLayer (Japanese SXF codes)', () => {
  it('classifies D-BCS-WALL as wall', () => {
    expect(classifyLayer('D-BCS-WALL')).toBe('wall');
    expect(classifyLayer('D_BCS_WALL')).toBe('wall');
  });
  it('classifies D-BCS-DOOR as door', () => {
    expect(classifyLayer('D-BCS-DOOR')).toBe('door');
    expect(classifyLayer('D_BCS_DOOR')).toBe('door');
  });
  it('classifies D-BCS-WIND/FNTR as window', () => {
    expect(classifyLayer('D-BCS-WIND')).toBe('window');
    expect(classifyLayer('D_BCS_FNTR')).toBe('window');
  });
  it('classifies D-BCS-PRTN as wall (partition)', () => {
    expect(classifyLayer('D-BCS-PRTN')).toBe('wall');
  });
  it('classifies D-BCS-STAR as stair', () => {
    expect(classifyLayer('D-BCS-STAR')).toBe('stair');
  });
});

describe('classifyLayer (Allplan / Nemetschek prefixes)', () => {
  it('classifies AR_WAND as wall', () => {
    expect(classifyLayer('AR_WAND')).toBe('wall');
    expect(classifyLayer('AR-WAND')).toBe('wall');
  });
  it('classifies AR-TUER as door', () => {
    expect(classifyLayer('AR-TUER')).toBe('door');
    expect(classifyLayer('AR_TUER')).toBe('door');
  });
  it('classifies AR_FENST as window', () => {
    expect(classifyLayer('AR_FENST')).toBe('window');
    expect(classifyLayer('AR-FENST')).toBe('window');
  });
  it('classifies AR_AW_TRAG / AR_AW / AR_IW as wall', () => {
    expect(classifyLayer('AR_AW_TRAG')).toBe('wall');
    expect(classifyLayer('AR_AW')).toBe('wall');
    expect(classifyLayer('AR_IW')).toBe('wall');
  });
});

describe('classifyLayer (curtain wall / mullion)', () => {
  it('classifies CURTAIN_WALL and MULLION as wall', () => {
    expect(classifyLayer('CURTAIN_WALL')).toBe('wall');
    expect(classifyLayer('CURTAIN-WALL')).toBe('wall');
    expect(classifyLayer('MULLION')).toBe('wall');
    expect(classifyLayer('TRANSOM')).toBe('wall');
    expect(classifyLayer('GLAZED_PARTITION')).toBe('wall');
    expect(classifyLayer('RIDEAU_MUR')).toBe('wall');
    expect(classifyLayer('VITRAIL')).toBe('wall');
  });
});

describe('classifyLayer (false-positive boundary checks)', () => {
  it('does NOT classify WALLPAPER as wall', () => {
    expect(classifyLayer('WALLPAPER')).toBe('underlay');
    expect(classifyLayer('WALLPAPER_PATTERN')).toBe('underlay');
  });
  it('does NOT classify DOORHANDLE/DOORFRAME as door', () => {
    expect(classifyLayer('DOORHANDLE_DETAIL')).toBe('underlay');
    expect(classifyLayer('DOORFRAME_HARDWARE')).toBe('underlay');
  });
  it('does NOT classify FENSTERBLECH/FENSTERPROFIL as window', () => {
    expect(classifyLayer('FENSTERBLECH')).toBe('underlay');
    expect(classifyLayer('FENSTERPROFIL')).toBe('underlay');
  });
  it('still classifies legitimate suffixed names', () => {
    expect(classifyLayer('WALL_EXT')).toBe('wall');
    expect(classifyLayer('DOOR_FRAME')).toBe('door');
    expect(classifyLayer('FENSTER')).toBe('window');
  });
});
