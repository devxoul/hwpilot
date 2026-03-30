import { readFile } from 'node:fs/promises'

import { loadHwp as sdkLoadHwp, loadHwpSectionTexts as sdkLoadHwpSectionTexts, extractParaText } from '@/sdk/formats/hwp/reader'
import type { HwpDocument } from '@/sdk/types'

export { extractParaText }

export async function loadHwp(filePath: string): Promise<HwpDocument> {
  const buffer = await readFile(filePath)
  return sdkLoadHwp(new Uint8Array(buffer))
}

export async function loadHwpSectionTexts(filePath: string): Promise<string[]> {
  const buffer = await readFile(filePath)
  return sdkLoadHwpSectionTexts(new Uint8Array(buffer))
}
