export type HwpFormat = 'hwp' | 'hwpx'

const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
const CFB_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])

export function detectFormat(buffer: Uint8Array): HwpFormat {
  if (buffer.length < 4) {
    throw new Error('File too small to determine format')
  }

  if (
    buffer[0] === ZIP_MAGIC[0] &&
    buffer[1] === ZIP_MAGIC[1] &&
    buffer[2] === ZIP_MAGIC[2] &&
    buffer[3] === ZIP_MAGIC[3]
  ) {
    return 'hwpx'
  }

  if (
    buffer[0] === CFB_MAGIC[0] &&
    buffer[1] === CFB_MAGIC[1] &&
    buffer[2] === CFB_MAGIC[2] &&
    buffer[3] === CFB_MAGIC[3]
  ) {
    return 'hwp'
  }

  throw new Error('Unsupported file format: not a valid HWP or HWPX file')
}
