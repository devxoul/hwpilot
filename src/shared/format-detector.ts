import { readFile } from 'node:fs/promises'

export type HwpFormat = 'hwp' | 'hwpx'

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0])

export async function detectFormat(filePath: string): Promise<HwpFormat> {
  const buffer = await readFile(filePath)
  return detectFormatFromBuffer(buffer)
}

export function detectFormatFromBuffer(buffer: Buffer): HwpFormat {
  if (buffer.length < 4) {
    throw new Error('File too small to determine format')
  }

  const magic = buffer.subarray(0, 4)

  if (magic.equals(ZIP_MAGIC)) {
    return 'hwpx'
  }

  if (magic.equals(CFB_MAGIC)) {
    return 'hwp'
  }

  throw new Error('Unsupported file format: not a valid HWP or HWPX file')
}
