import { describe, expect, it } from 'vitest';
import { classifyInsert, placeOpenings } from '../src/openings.js';
import type { ImportedInsert, WallSpec } from '../src/types.js';

const wall = (
  sx: number,
  sz: number,
  ex: number,
  ez: number,
  layer = 'A-WALL',
): WallSpec => ({
  start: [sx, sz],
  end: [ex, ez],
  thickness: 0.1,
  height: 2.5,
  materialPreset: 'preset-white',
  sourceLayer: layer,
});

const insert = (overrides: Partial<ImportedInsert> = {}): ImportedInsert => ({
  blockName: 'DOOR_SINGLE',
  position: [0, 0],
  elevation: 0,
  rotation: 0,
  xScale: 1,
  yScale: 1,
  layer: 'A-DOOR',
  ...overrides,
});

describe('classifyInsert', () => {
  it('matches door layer names case-insensitively', () => {
    expect(classifyInsert('GENERIC', 'A-DOOR')).toBe('door');
    expect(classifyInsert('GENERIC', 'doors')).toBe('door');
    expect(classifyInsert('GENERIC', 'TUER')).toBe('door');
    expect(classifyInsert('GENERIC', 'PORTE-INT')).toBe('door');
    expect(classifyInsert('GENERIC', 'PUERTA-2')).toBe('door');
  });

  it('matches window layer names case-insensitively', () => {
    expect(classifyInsert('GENERIC', 'A-GLAZ')).toBe('window');
    expect(classifyInsert('GENERIC', 'WINDOWS')).toBe('window');
    expect(classifyInsert('GENERIC', 'A-WIN-FRAME')).toBe('window');
    expect(classifyInsert('GENERIC', 'FENSTER')).toBe('window');
    expect(classifyInsert('GENERIC', 'FENETRE-1')).toBe('window');
    expect(classifyInsert('GENERIC', 'VENTANA')).toBe('window');
    expect(classifyInsert('GENERIC', 'SERRAMENTI-EXT')).toBe('window');
  });

  it('falls back to block name when layer is unrelated', () => {
    expect(classifyInsert('DOOR_36IN', 'MISC')).toBe('door');
    expect(classifyInsert('TUER-90', 'MISC')).toBe('door');
    expect(classifyInsert('WIN_DBL', 'MISC')).toBe('window');
    expect(classifyInsert('FENSTER-1', 'MISC')).toBe('window');
    expect(classifyInsert('GLAZ_PANEL', 'MISC')).toBe('window');
  });

  it('returns null for unrelated block names and layers', () => {
    expect(classifyInsert('CHAIR', 'A-FURN')).toBeNull();
    expect(classifyInsert('TREE', 'L-PLANT')).toBeNull();
    expect(classifyInsert('', '')).toBeNull();
  });

  it('prefers layer over block when both could match different kinds', () => {
    // Layer says door, block says window — layer wins.
    expect(classifyInsert('WIN_DBL', 'A-DOOR')).toBe('door');
  });
});

describe('placeOpenings', () => {
  it('places a door at midpoint of a wall', () => {
    const walls = [wall(0, 0, 4, 0)];
    const inserts = [insert({ position: [2, 0] })];
    const r = placeOpenings(walls, inserts);
    expect(r.doors).toHaveLength(1);
    expect(r.windows).toHaveLength(0);
    expect(r.unplacedInserts).toBe(0);
    const d = r.doors[0];
    if (!d) throw new Error('expected door');
    expect(d.wallIndex).toBe(0);
    expect(d.positionAlongWall).toBeCloseTo(0.5, 9);
    expect(d.width).toBe(0.9);
    expect(d.height).toBe(2.1);
    expect(d.swingDirection).toBe('inward');
  });

  it('counts inserts outside snap tolerance as unplaced', () => {
    const walls = [wall(0, 0, 4, 0)];
    // 2 m perpendicular offset, default tolerance is 0.5 m.
    const inserts = [insert({ blockName: 'WIN_1', layer: 'A-GLAZ', position: [2, 2] })];
    const r = placeOpenings(walls, inserts);
    expect(r.windows).toHaveLength(0);
    expect(r.doors).toHaveLength(0);
    expect(r.unplacedInserts).toBe(1);
  });

  it('rejects inserts too close to a wall corner (t < 0.05)', () => {
    const walls = [wall(0, 0, 10, 0)];
    // t = 0.1 / 10 = 0.01 → below T_MIN.
    const inserts = [insert({ position: [0.1, 0] })];
    const r = placeOpenings(walls, inserts);
    expect(r.doors).toHaveLength(0);
    expect(r.unplacedInserts).toBe(1);
  });

  it('rejects inserts too close to wall end (t > 0.95)', () => {
    const walls = [wall(0, 0, 10, 0)];
    const inserts = [insert({ position: [9.9, 0] })];
    const r = placeOpenings(walls, inserts);
    expect(r.doors).toHaveLength(0);
    expect(r.unplacedInserts).toBe(1);
  });

  it('snaps an insert to the nearer of two walls', () => {
    const walls = [
      wall(0, 0, 4, 0), // wall 0: along z=0
      wall(0, 5, 4, 5), // wall 1: along z=5
    ];
    // Position is 0.1 m from wall 1, ~5 m from wall 0.
    const inserts = [insert({ position: [2, 4.9] })];
    const r = placeOpenings(walls, inserts);
    expect(r.doors).toHaveLength(1);
    const d = r.doors[0];
    if (!d) throw new Error('expected door');
    expect(d.wallIndex).toBe(1);
    expect(d.positionAlongWall).toBeCloseTo(0.5, 9);
  });

  it('classifies windows distinctly from doors', () => {
    const walls = [wall(0, 0, 4, 0)];
    const inserts = [
      insert({ blockName: 'WIN_DBL', layer: 'A-GLAZ', position: [2, 0] }),
    ];
    const r = placeOpenings(walls, inserts);
    expect(r.windows).toHaveLength(1);
    expect(r.doors).toHaveLength(0);
    const w = r.windows[0];
    if (!w) throw new Error('expected window');
    expect(w.width).toBe(1.5);
    expect(w.height).toBe(1.5);
    expect(w.sillHeight).toBe(0.9);
  });

  it('derives hingesSide from rotation sign', () => {
    const walls = [wall(0, 0, 4, 0)];
    const r1 = placeOpenings(walls, [insert({ position: [2, 0], rotation: 45 })]);
    const r2 = placeOpenings(walls, [insert({ position: [2, 0], rotation: 200 })]);
    const r3 = placeOpenings(walls, [insert({ position: [2, 0], rotation: -90 })]); // → 270
    expect(r1.doors[0]?.hingesSide).toBe('left');
    expect(r2.doors[0]?.hingesSide).toBe('right');
    expect(r3.doors[0]?.hingesSide).toBe('right');
  });

  it('returns an empty result for empty inputs', () => {
    expect(placeOpenings([], [])).toEqual({ doors: [], windows: [], unplacedInserts: 0 });
    expect(placeOpenings([wall(0, 0, 4, 0)], [])).toEqual({
      doors: [],
      windows: [],
      unplacedInserts: 0,
    });
    expect(placeOpenings([], [insert({ position: [0, 0] })])).toEqual({
      doors: [],
      windows: [],
      unplacedInserts: 1,
    });
  });

  it('skips zero-length walls without crashing', () => {
    const walls = [
      wall(1, 1, 1, 1), // degenerate
      wall(0, 0, 4, 0), // valid
    ];
    const inserts = [insert({ position: [2, 0] })];
    const r = placeOpenings(walls, inserts);
    expect(r.doors).toHaveLength(1);
    expect(r.doors[0]?.wallIndex).toBe(1);
  });

  it('skips walls/inserts containing NaN safely', () => {
    const walls = [
      { ...wall(0, 0, 4, 0), end: [Number.NaN, 0] as [number, number] },
      wall(0, 0, 4, 0),
    ];
    const inserts = [
      insert({ position: [Number.NaN, 0] }),
      insert({ position: [2, 0] }),
    ];
    const r = placeOpenings(walls, inserts);
    expect(r.doors).toHaveLength(1);
    expect(r.doors[0]?.wallIndex).toBe(1);
    expect(r.unplacedInserts).toBe(1);
  });

  it('ignores inserts that do not classify as door or window', () => {
    const walls = [wall(0, 0, 4, 0)];
    const inserts = [
      insert({ blockName: 'CHAIR', layer: 'A-FURN', position: [2, 0] }),
    ];
    const r = placeOpenings(walls, inserts);
    expect(r.doors).toHaveLength(0);
    expect(r.windows).toHaveLength(0);
    expect(r.unplacedInserts).toBe(0);
  });

  it('honors custom default dimensions and snap tolerance', () => {
    const walls = [wall(0, 0, 4, 0)];
    const inserts = [
      insert({ position: [2, 0.7] }), // 0.7 m off — outside default 0.5 m
    ];
    const r = placeOpenings(walls, inserts, {
      snapTolerance: 1,
      defaultDoorWidth: 1.0,
      defaultDoorHeight: 2.4,
    });
    expect(r.doors).toHaveLength(1);
    const d = r.doors[0];
    if (!d) throw new Error('expected door');
    expect(d.width).toBe(1.0);
    expect(d.height).toBe(2.4);
  });
});
