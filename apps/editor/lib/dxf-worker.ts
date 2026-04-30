/**
 * Web Worker for DXF parsing. Offloads the synchronous parser off the main
 * thread for files larger than ~5 MB so the editor stays responsive.
 *
 * Uses Comlink for ergonomic typed RPC. The wrapper in
 * apps/editor/lib/dxf-import-client.ts decides whether to dispatch here or
 * fall back to direct in-process parsing for tiny files.
 */
import { importDxf, type ImportOptions, type ImportResult } from '@pascal-app/dxf-importer'
import * as Comlink from 'comlink'

const api = {
  parse(text: string, options: ImportOptions | undefined): ImportResult {
    return importDxf(text, options)
  },
}

export type DxfWorkerApi = typeof api

Comlink.expose(api)
