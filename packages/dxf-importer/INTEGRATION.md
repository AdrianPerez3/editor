# Integration guide

How to wire `@pascal-app/dxf-importer` into the Pascal editor app.

## Status

End-to-end integration is now wired. What ships in the current PR:

- **Sonner toasts** — success / error / warning / info via `apps/editor/app/layout.tsx <Toaster />`. The button uses `toast.loading` → `toast.success` for the import lifecycle.
- **Walls** — every `WallSpec` becomes a schema-valid `WallNode` attached to the active level.
- **Doors and windows** — `placeOpenings()` snaps `INSERT` blocks to the nearest wall (≤ 0.5 m perpendicular tolerance, parametric position in [0.05, 0.95]) and produces `DoorSpec` / `WindowSpec`. The button creates `DoorNode` / `WindowNode` with `wallId` set so the wall CSG cuts the opening.
- **2D underlay** — `generateUnderlaySvg()` rasterizes non-wall lines into an SVG, encoded as a `data:image/svg+xml;base64,...` URL and surfaced as a `GuideNode` on the level (opacity 35, scaled to bbox).
- **Atomic undo** — every node created by an import lands in a single `useScene.temporal.pause()/resume()` block, so Ctrl/Cmd+Z reverts the whole import.
- **DWG rejection** — files with the binary DWG magic header trigger a long-form toast pointing at the free [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter).
- **Real-shaped fixtures** — `revit-metric-export.dxf`, `sketchup-imperial-quirk.dxf`, `civil3d-unitless.dxf`, `house-with-doors.dxf` exercise common exporter quirks.

What's still browser-test-only (NOT verified in CI):

- **Door/window rotation sign** — `rotation: [0, -wallAngleY, 0]` is our best guess. If openings render mirrored or 90° off, flip the sign.
- **GuideNode plane scaling** — the existing `GuideNode` renderer hard-codes a 10 m wide plane scaled by aspect; we set `scale = max(width, height) / 10` as a compensating factor. May need adjustment for non-square underlays.
- **Visual fidelity** of the SVG underlay against the actual 3D scene.

Web Worker (large file offload):

- `apps/editor/lib/dxf-worker.ts` and `apps/editor/lib/dxf-import-client.ts` ship a Comlink-backed worker that wraps `importDxf`.
- Files larger than 5 MB are dispatched to the worker; smaller files parse inline.
- **Currently unused by the button** because the button lives in `packages/editor` and cannot import from `apps/editor`. To activate: move `DxfImportButton` to `apps/editor/components/`, add an `importSlot?: ReactNode` prop to `SettingsPanelProps`, and pass it from where SettingsPanel is rendered. Worker is ready to consume.

Deferred to follow-up PRs:

- **Layer-mapping table UI** — interactive table letting users override regex classification per layer with savable presets. Auto-classify covers ~75-80% per research; long tail needs UX iteration.
- **Multi-floor detection wiring** — `detectFloorsFromZ()` is exported but not invoked. Needs UX (sibling-file picker, Z-cluster prompt, alignment).
- **Real-DXF testing** — exercise on actual Revit/AutoCAD/SketchUp exports beyond the synthetic fixtures.

## DWG handling (issue #158)

- v1: client-side `detectFileFormat` + `assertNotDwg` reject `.dwg` uploads
  with a friendly modal linking to
  https://www.opendesign.com/guestfiles/oda_file_converter (free, ODA's
  "guest" download).
- v1.1 (when DWG volume justifies): server-side conversion via CloudConvert
  REST (~$0.02/conversion, clean license posture, no infra) — call from a
  Next.js API route, then feed the resulting DXF to `importDxf()`.
  Aspose.CAD Cloud is the alternative if CAD fidelity is the priority.
- Avoid: bundling LibreDWG WASM in the browser (GPL-3.0 contagion), bundling
  ODA File Converter binary in Docker (EULA does not grant SaaS rights).

Rejection flow at the file-upload handler:

```ts
import {
  assertNotDwg,
  dwgGuidanceMessage,
  UnsupportedDwgError,
  importDxf,
} from '@pascal-app/dxf-importer';

async function handleUpload(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    assertNotDwg(bytes);
  } catch (e) {
    if (e instanceof UnsupportedDwgError) {
      // show modal with dwgGuidanceMessage(), then bail
      return;
    }
    throw e;
  }
  const text = new TextDecoder().decode(bytes);
  const result = importDxf(text);
  // ...continue with WallSpec -> WallNode below
}
```

## 1. Add the dependency

In `apps/editor/package.json`:

```jsonc
"dependencies": {
  "@pascal-app/dxf-importer": "*"
}
```

## 2. Translate `WallSpec` -> `WallNode` and dispatch

```ts
import { importDxf } from '@pascal-app/dxf-importer';
import { useScene, WallNode } from '@pascal-app/core';
// generateId from `@pascal-app/core` schema/nodes/base.ts

async function handleDxfFile(file: File, targetLevelId: string) {
  const text = await file.text();
  const result = importDxf(text, {
    defaultWallHeight: 2.5,
    defaultWallThickness: 0.1,
  });

  if (result.warnings.some(w => w.code === 'parse_error')) {
    // Surface error to user (toast).
    return;
  }

  const ops = result.walls.map(spec => ({
    node: WallNode.parse({
      type: 'wall',
      start: spec.start,
      end: spec.end,
      thickness: spec.thickness,
      height: spec.height,
      materialPreset: spec.materialPreset,
    }),
    parentId: targetLevelId,
  }));

  // Group the entire batch into ONE undo step.
  const sceneStore = useScene;
  sceneStore.temporal.getState().pause();
  try {
    sceneStore.getState().createNodes(ops);
  } finally {
    sceneStore.temporal.getState().resume();
  }

  // result.stats: counts, units, bbox -> show in success toast
  // result.warnings: surface in a "View report" dialog
}
```

## 3. UI surfaces (deferred)

Recommended placement:
- New "Import DXF" entry next to the existing **ExportManager** in
  `packages/editor/src/components/editor/export-manager.tsx`. Mirror the
  store-registration pattern with a parallel **ImportManager**.
- A Radix `Dialog` (file picker -> options -> review) using the existing
  `packages/editor/src/components/ui/primitives/dialog.tsx`.
- A persistent **progress card** anchored above the sidebar (similar to
  `useUploadStore` for GLB scans).
- For UX of the layer-mapping table, see the design notes from the research
  in this branch's PR description.

## 4. Toast / notifications

The codebase has no toast library yet. Recommend `sonner` (zero deps,
shadcn-default, Radix-friendly). Install + add a single `<Toaster />` mount in
`apps/editor/app/layout.tsx` before the importer ships.

## 5. Web worker (large files)

For DXFs > 5 MB, parsing should run in a Web Worker to avoid blocking the
main thread. Pattern:

```ts
// apps/editor/lib/workers/dxf-worker.ts
import { importDxf } from '@pascal-app/dxf-importer';
self.onmessage = (e: MessageEvent<{ text: string }>) => {
  const result = importDxf(e.data.text);
  self.postMessage(result);
};
```

```ts
// in the calling component (client-only):
const worker = new Worker(new URL('@/lib/workers/dxf-worker.ts', import.meta.url), { type: 'module' });
```

Next.js 16 + Turbopack honours this pattern natively; no config changes.

## 6. Feature flag

Gate the import UI behind `NEXT_PUBLIC_ENABLE_DXF_IMPORT === 'true'` for the
first release, then default-enable after a stabilization period.
