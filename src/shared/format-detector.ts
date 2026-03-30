import { readFile } from 'node:fs/promises'

import { detectFormat as sdkDetectFormat, type HwpFormat } from '@/sdk/format-detector'

export type { HwpFormat }

export function detectFormatFromBuffer(buffer: Buffer): HwpFormat {
  return sdkDetectFormat(buffer)
}

export async function detectFormat(filePath: string): Promise<HwpFormat> {
  const buffer = await readFile(filePath)
  return sdkDetectFormat(new Uint8Array(buffer))
}
