/**
 * DXF/DWG import button. Wires @pascal-app/dxf-importer into the editor:
 *
 *   1. User picks a .dxf or .dwg file.
 *   2. We sniff the format. DWG is rejected with a guidance message pointing
 *      to ODA File Converter (issue #158, Phase A).
 *   3. DXF text is parsed via importDxf() into WallSpec[] + warnings + stats.
 *   4. WallSpec[] is mapped to schema-valid WallNodes and dispatched in a
 *      single createNodes batch wrapped in temporal.pause/resume so the entire
 *      import is one undo step.
 *
 * NOT verified in this commit: the actual user-facing flow has not been
 * exercised in a running browser. Type checks pass, the dxf-importer package
 * has 101 unit tests, but Cmd+Z grouping, file-picker UX, and visual results
 * need browser validation. See packages/dxf-importer/INTEGRATION.md.
 */

import {
  type ImportResult,
  UnsupportedDwgError,
  assertNotDwg,
  dwgGuidanceMessage,
  importDxf,
} from '@pascal-app/dxf-importer'
import { type AnyNodeId, useScene, WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from './../../../../../components/ui/primitives/button'

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'success'; result: ImportResult }
  | { kind: 'error'; message: string }
  | { kind: 'dwg' }

function findTargetLevelId(): string | null {
  const viewerLevelId = useViewer.getState().selection?.levelId
  if (typeof viewerLevelId === 'string' && viewerLevelId.length > 0) {
    return viewerLevelId
  }
  // Fallback: first level node anywhere in the scene.
  const nodes = useScene.getState().nodes
  for (const node of Object.values(nodes)) {
    if (node && (node as { type?: string }).type === 'level') {
      const id = (node as { id?: unknown }).id
      if (typeof id === 'string') return id
    }
  }
  return null
}

export function DxfImportButton() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setStatus({ kind: 'busy' })

    try {
      const buf = new Uint8Array(await file.arrayBuffer())

      try {
        assertNotDwg(buf)
      } catch (err) {
        if (err instanceof UnsupportedDwgError) {
          setStatus({ kind: 'dwg' })
          return
        }
        throw err
      }

      const text = new TextDecoder().decode(buf)
      const result = importDxf(text)

      const parseError = result.warnings.find((w) => w.code === 'parse_error')
      if (parseError) {
        setStatus({ kind: 'error', message: parseError.message })
        return
      }
      if (result.walls.length === 0) {
        setStatus({
          kind: 'error',
          message:
            'No wall-layer geometry detected. Check that walls are on a recognized layer (e.g., A-WALL, WALL, MUR, WAND).',
        })
        return
      }

      const levelId = findTargetLevelId()
      if (!levelId) {
        setStatus({
          kind: 'error',
          message: 'No level found. Add a level to the building first.',
        })
        return
      }

      const ops = result.walls.map((spec) => ({
        node: WallNode.parse({
          type: 'wall',
          start: spec.start,
          end: spec.end,
          thickness: spec.thickness,
          height: spec.height,
          materialPreset: spec.materialPreset,
        }),
        parentId: levelId as AnyNodeId,
      }))

      const sceneStore = useScene
      sceneStore.temporal.getState().pause()
      try {
        sceneStore.getState().createNodes(ops)
      } finally {
        sceneStore.temporal.getState().resume()
      }

      setStatus({ kind: 'success', result })
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <div className="space-y-1">
      <Button
        className="w-full justify-start gap-2"
        disabled={status.kind === 'busy'}
        onClick={() => fileInputRef.current?.click()}
        variant="outline"
      >
        <Upload className="size-4" />
        {status.kind === 'busy' ? 'Importing…' : 'Import DXF / DWG'}
      </Button>
      <input
        accept=".dxf,.dwg,application/dxf,application/dwg,application/octet-stream"
        className="hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
      {status.kind === 'success' && (
        <p className="px-1 text-muted-foreground text-xs">
          {status.result.walls.length} wall{status.result.walls.length === 1 ? '' : 's'} imported
          {status.result.warnings.length > 0
            ? ` · ${status.result.warnings.length} warning${status.result.warnings.length === 1 ? '' : 's'}`
            : ''}
          {' · '}
          unit: {status.result.stats.unit} ({status.result.stats.unitSource})
        </p>
      )}
      {status.kind === 'error' && (
        <p className="px-1 text-destructive text-xs">{status.message}</p>
      )}
      {status.kind === 'dwg' && (
        <p className="px-1 text-muted-foreground text-xs">{dwgGuidanceMessage()}</p>
      )}
    </div>
  )
}
