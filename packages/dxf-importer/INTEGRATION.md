# Integration guide

How to wire `@pascal-app/dxf-importer` into the Pascal editor app. This file
documents the recommended approach. The actual UI components are intentionally
left for a follow-up PR — landing them needs UX iteration that benefits from
maintainer review.

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
