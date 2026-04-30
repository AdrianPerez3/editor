/**
 * Client-side wrapper around the DXF importer. Decides whether to parse
 * inline (small files, ~5 MB cutoff) or dispatch to a Web Worker so the
 * main thread stays responsive on large files.
 */
import {
  importDxf,
  type ImportOptions,
  type ImportResult,
} from '@pascal-app/dxf-importer'
import * as Comlink from 'comlink'
import type { DxfWorkerApi } from './dxf-worker'

const WORKER_THRESHOLD_BYTES = 5 * 1024 * 1024

let workerInstance: Worker | null = null
let workerApi: Comlink.Remote<DxfWorkerApi> | null = null

function getWorker(): Comlink.Remote<DxfWorkerApi> | null {
  if (typeof window === 'undefined') return null
  if (typeof Worker === 'undefined') return null
  if (workerApi) return workerApi
  try {
    workerInstance = new Worker(new URL('./dxf-worker.ts', import.meta.url), {
      type: 'module',
    })
    workerApi = Comlink.wrap<DxfWorkerApi>(workerInstance)
    return workerApi
  } catch {
    // Worker construction can fail in older browsers or sandboxed iframes.
    workerInstance = null
    workerApi = null
    return null
  }
}

export async function importDxfInBackground(
  text: string,
  options?: ImportOptions,
): Promise<ImportResult> {
  if (text.length < WORKER_THRESHOLD_BYTES) {
    return importDxf(text, options)
  }
  const worker = getWorker()
  if (!worker) {
    return importDxf(text, options)
  }
  try {
    return await worker.parse(text, options)
  } catch (err) {
    // Worker died or message-passing failed — retry on main thread once.
    return importDxf(text, options)
  }
}

export function disposeDxfWorker(): void {
  if (workerInstance) workerInstance.terminate()
  workerInstance = null
  workerApi = null
}
