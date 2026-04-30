/**
 * DXF/DWG import button — wires @pascal-app/dxf-importer into the editor.
 *
 * Pipeline on click of a .dxf file:
 *   1. assertNotDwg() — DWG rejected with sonner toast pointing to ODA converter
 *   2. importDxf() — parse + map → walls, inserts, underlay, warnings, stats
 *   3. Resolve target level (active selection or first level)
 *   4. createNodes(walls) — collect new wall IDs
 *   5. placeOpenings() → DoorSpec/WindowSpec; createNodes(doors+windows) attached via wallId
 *   6. generateUnderlaySvg() → data URL → GuideNode at the bbox center
 *   7. All inside one temporal.pause()/resume() so Cmd+Z undoes the entire import
 *
 * Browser-test caveats (not verified in CI):
 *   - DoorNode/WindowNode rotation around Y matches wall direction; sign
 *     convention may need adjustment if doors render mirrored.
 *   - GuideNode plane is rendered at fixed 10m × aspect ratio per existing
 *     renderer; we set `scale = widthMeters / 10` as a compensating factor.
 *     Visual fidelity needs eyeball verification.
 *   - Worker-backed parsing for >5 MB files is wired in apps/editor/lib/
 *     but this button uses the synchronous path; injecting the worker
 *     requires a parser callback prop, deferred to a follow-up.
 */

import {
  type AnyNodeId,
  DoorNode,
  GuideNode,
  useScene,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import {
  assertNotDwg,
  dwgGuidanceMessage,
  generateUnderlaySvg,
  type ImportResult,
  importDxf,
  placeOpenings,
  svgToDataUrl,
  UnsupportedDwgError,
} from '@pascal-app/dxf-importer'
import { useViewer } from '@pascal-app/viewer'
import { Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from './../../../../../components/ui/primitives/button'

function findTargetLevelId(): string | null {
  const viewerLevelId = useViewer.getState().selection?.levelId
  if (typeof viewerLevelId === 'string' && viewerLevelId.length > 0) {
    return viewerLevelId
  }
  const nodes = useScene.getState().nodes
  for (const node of Object.values(nodes)) {
    if (node && (node as { type?: string }).type === 'level') {
      const id = (node as { id?: unknown }).id
      if (typeof id === 'string') return id
    }
  }
  return null
}

function buildWallOps(
  result: ImportResult,
  levelId: AnyNodeId,
): Array<{ node: ReturnType<typeof WallNode.parse>; parentId: AnyNodeId; sourceIndex: number }> {
  return result.walls.map((spec, sourceIndex) => ({
    node: WallNode.parse({
      type: 'wall',
      start: spec.start,
      end: spec.end,
      thickness: spec.thickness,
      height: spec.height,
      materialPreset: spec.materialPreset,
    }),
    parentId: levelId,
    sourceIndex,
  }))
}

function wallAngleY(start: [number, number], end: [number, number]): number {
  return Math.atan2(end[1] - start[1], end[0] - start[0])
}

function commitImport(result: ImportResult, levelId: AnyNodeId): {
  wallCount: number
  doorCount: number
  windowCount: number
  underlayCreated: boolean
  unplacedInserts: number
} {
  const sceneStore = useScene
  sceneStore.temporal.getState().pause()
  try {
    // 1. Walls — record (sourceIndex → wallId) so openings can attach via wallId.
    const wallOps = buildWallOps(result, levelId)
    sceneStore.getState().createNodes(wallOps)
    const wallIdByIndex = new Map<number, string>()
    for (const op of wallOps) wallIdByIndex.set(op.sourceIndex, op.node.id)

    // 2. Openings — translate DoorSpec/WindowSpec into editor schema.
    const openings = placeOpenings(result.walls, result.inserts)
    const doorOps = openings.doors
      .map((d) => {
        const spec = result.walls[d.wallIndex]
        const wallId = wallIdByIndex.get(d.wallIndex)
        if (!spec || !wallId) return null
        const dx = spec.end[0] - spec.start[0]
        const dz = spec.end[1] - spec.start[1]
        const t = d.positionAlongWall
        const px = spec.start[0] + dx * t
        const pz = spec.start[1] + dz * t
        return {
          node: DoorNode.parse({
            type: 'door',
            position: [px, d.height / 2, pz],
            rotation: [0, -wallAngleY(spec.start, spec.end), 0],
            wallId,
            width: d.width,
            height: d.height,
            hingesSide: d.hingesSide,
            swingDirection: d.swingDirection,
          }),
          parentId: wallId as AnyNodeId,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    const windowOps = openings.windows
      .map((w) => {
        const spec = result.walls[w.wallIndex]
        const wallId = wallIdByIndex.get(w.wallIndex)
        if (!spec || !wallId) return null
        const dx = spec.end[0] - spec.start[0]
        const dz = spec.end[1] - spec.start[1]
        const t = w.positionAlongWall
        const px = spec.start[0] + dx * t
        const pz = spec.start[1] + dz * t
        return {
          node: WindowNode.parse({
            type: 'window',
            position: [px, w.sillHeight + w.height / 2, pz],
            rotation: [0, -wallAngleY(spec.start, spec.end), 0],
            wallId,
            width: w.width,
            height: w.height,
          }),
          parentId: wallId as AnyNodeId,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (doorOps.length > 0 || windowOps.length > 0) {
      sceneStore.getState().createNodes([...doorOps, ...windowOps])
    }

    // 3. Underlay — render non-wall lines as an SVG-backed GuideNode.
    let underlayCreated = false
    if (result.underlay.length > 0 && result.stats.bbox) {
      const svg = generateUnderlaySvg(result.underlay)
      if (svg) {
        const url = svgToDataUrl(svg.svg)
        const cx = (result.stats.bbox.min[0] + result.stats.bbox.max[0]) / 2
        const cz = (result.stats.bbox.min[1] + result.stats.bbox.max[1]) / 2
        // The existing GuideNode renderer draws at fixed ~10m width with
        // aspect from the loaded image; we approximate scale to match the
        // SVG's editor-meter extents.
        const scale = Math.max(svg.widthMeters, svg.heightMeters) / 10
        sceneStore.getState().createNodes([
          {
            node: GuideNode.parse({
              type: 'guide',
              url,
              position: [cx, 0.001, cz],
              scale,
              opacity: 35,
              name: 'DXF Underlay',
            }),
            parentId: levelId,
          },
        ])
        underlayCreated = true
      }
    }

    return {
      wallCount: result.walls.length,
      doorCount: doorOps.length,
      windowCount: windowOps.length,
      underlayCreated,
      unplacedInserts: openings.unplacedInserts,
    }
  } finally {
    sceneStore.temporal.getState().resume()
  }
}

export function DxfImportButton() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setBusy(true)

    const importToast = toast.loading(`Importing ${file.name}…`)

    try {
      const buf = new Uint8Array(await file.arrayBuffer())

      try {
        assertNotDwg(buf)
      } catch (err) {
        if (err instanceof UnsupportedDwgError) {
          toast.error('DWG files need conversion', {
            id: importToast,
            description: dwgGuidanceMessage(),
            duration: 12000,
          })
          return
        }
        throw err
      }

      const text = new TextDecoder().decode(buf)
      const result = importDxf(text)

      const parseError = result.warnings.find((w) => w.code === 'parse_error')
      if (parseError) {
        toast.error('Could not parse DXF', {
          id: importToast,
          description: parseError.message,
        })
        return
      }
      if (result.walls.length === 0) {
        toast.warning('No walls detected', {
          id: importToast,
          description:
            'Check that walls are on a recognized layer (A-WALL, WALL, MUR, WAND, …) or override the layer mapping.',
        })
        return
      }

      const levelId = findTargetLevelId()
      if (!levelId) {
        toast.error('No level found', {
          id: importToast,
          description: 'Add a level to the building first.',
        })
        return
      }

      const counts = commitImport(result, levelId as AnyNodeId)
      const parts = [`${counts.wallCount} wall${counts.wallCount === 1 ? '' : 's'}`]
      if (counts.doorCount > 0) parts.push(`${counts.doorCount} door${counts.doorCount === 1 ? '' : 's'}`)
      if (counts.windowCount > 0)
        parts.push(`${counts.windowCount} window${counts.windowCount === 1 ? '' : 's'}`)
      if (counts.underlayCreated) parts.push('2D underlay')

      const description: string[] = []
      description.push(`Unit: ${result.stats.unit} (${result.stats.unitSource})`)
      if (counts.unplacedInserts > 0)
        description.push(`${counts.unplacedInserts} insert${counts.unplacedInserts === 1 ? '' : 's'} unplaced`)
      if (result.warnings.length > 0)
        description.push(`${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}`)

      toast.success(`Imported ${parts.join(' · ')}`, {
        id: importToast,
        description: description.join(' · '),
      })
    } catch (err) {
      toast.error('Import failed', {
        id: importToast,
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        className="w-full justify-start gap-2"
        disabled={busy}
        onClick={() => fileInputRef.current?.click()}
        variant="outline"
      >
        <Upload className="size-4" />
        {busy ? 'Importing…' : 'Import DXF / DWG'}
      </Button>
      <input
        accept=".dxf,.dwg,application/dxf,application/dwg,application/octet-stream"
        className="hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
    </>
  )
}
