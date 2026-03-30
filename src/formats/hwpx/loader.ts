import { readFile } from 'node:fs/promises'

import { loadHwpx as sdkLoadHwpx, type HwpxArchive } from '@/sdk/formats/hwpx/loader'

export type { HwpxArchive }

export async function loadHwpx(filePath: string): Promise<HwpxArchive> {
  let fileBuffer: Buffer
  try {
    fileBuffer = await readFile(filePath)
  } catch (err) {
    throw new Error(`Failed to read file: ${filePath} — ${(err as Error).message}`)
  }

  try {
    return await sdkLoadHwpx(new Uint8Array(fileBuffer))
  } catch (err) {
    throw new Error(`Failed to parse HWPX file as ZIP: ${filePath} — ${(err as Error).message}`)
  }
}
