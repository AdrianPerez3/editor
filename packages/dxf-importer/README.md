# @pascal-app/dxf-importer

DXF (AutoCAD) parser and floor-plan importer for the Pascal 3D editor.

Addresses [pascalorg/editor#158](https://github.com/pascalorg/editor/issues/158): "Import option for AutoCAD files."

## What this package does

- Parses ASCII DXF text via `dxf-parser` (MIT)
- Resolves units from `$INSUNITS` with bbox heuristic fallback
- Classifies layers against multilingual AIA/ISO conventions (English, German, French, Spanish, Italian, Japanese)
- Tessellates `LWPOLYLINE` bulges and `ARC`/`CIRCLE` entities into chord segments
- Maps wall-layer line/polyline segments to `WallSpec` objects ready for the editor scene
- Routes non-wall entities to a 2D underlay channel
- Recenters geometry around origin and converts DXF (Z-up) to editor (Y-up XZ-plane)
- Detects DWG (binary AutoCAD) uploads and rejects them with a guidance message pointing to free conversion tools.

## What this package does **not** do

- DWG (binary AutoCAD) — detected and rejected with guidance. Server-side
  conversion (ODA / Aspose.CAD Cloud / CloudConvert) is documented in
  INTEGRATION.md as a follow-up phase. There is no permissive-license JS DWG
  parser as of 2026.
- Door / window placement on walls. v1 emits walls only; door INSERT blocks
  fall through to the 2D underlay until the door-attachment heuristic ships.
- `SPLINE`, `HATCH`, `DIMENSION` entities — these are counted as
  unsupported and reported via `ImportWarning`s.

## Usage

```ts
import { importDxf } from '@pascal-app/dxf-importer';

const text = await file.text();
const result = importDxf(text, {
  defaultWallHeight: 2.5,
  defaultWallThickness: 0.1,
  // unitOverride: 'mm',          // override $INSUNITS
  // recenterToOrigin: true,
  // layerMap: { 'CUSTOM-WALL': 'wall' },
});

// result.walls   — WallSpec[] in meters, level-local coords
// result.underlay — UnderlayLine[] for non-wall entities
// result.stats   — counts, unit detection, bbox
// result.warnings — non-fatal issues (parse, missing units, skipped entities)
```

The caller is responsible for translating `WallSpec` into editor `WallNode`
instances and dispatching them via `useScene.createNodes(...)` inside a single
`temporal.pause()/resume()` block so the import is one undo step.

To reject DWG uploads early with a friendly message:

```ts
import { assertNotDwg, dwgGuidanceMessage } from '@pascal-app/dxf-importer';
try {
  assertNotDwg(fileBytes);
} catch (e) {
  // show modal with dwgGuidanceMessage()
}
```

## Layer-classifier coverage

The classifier recognizes wall layers across these convention families:

- AIA (American Institute of Architects) — `A-WALL`, `A-WALL-EXTR`, etc.
- Generic English — `WALL`, `WALLS`, `INTERIOR-WALL`
- Italian — `MURO`, `MURI`, `PARETE`, `PARETI`
- German Allplan — `WAND`, `WAENDE`, Allplan layer prefixes
- French / AFNOR — `MUR`, `MURS`, `CLOISON`
- Spanish — `MURO`, `MUROS`, `PARED`, `PAREDES`
- Japanese SXF — `KABE`, `壁`
- Chinese — `墙`, `牆`

## Test fixtures

`tests/fixtures/` holds hand-crafted minimal DXF files committed verbatim
(no third-party content). Each is under 100 lines and exercises one specific
concern (single LINE, closed LWPOLYLINE, multi-layer mix, missing units,
empty file).

## Running tests

```sh
bun run --filter @pascal-app/dxf-importer test
```

## License

MIT.
