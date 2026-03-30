export type RecordHeader = {
  tagId: number
  level: number
  size: number
  headerSize: number
}

export function parseRecordHeader(buffer: Buffer, offset: number): RecordHeader | null {
  if (offset + 4 > buffer.length) return null
  const packed = buffer.readUInt32LE(offset)
  const tagId = packed & 0x3ff
  const level = (packed >> 10) & 0x3ff
  const size = (packed >> 20) & 0xfff

  if (size === 0xfff) {
    if (offset + 8 > buffer.length) return null
    const extSize = buffer.readUInt32LE(offset + 4)
    return { tagId, level, size: extSize, headerSize: 8 }
  }

  return { tagId, level, size, headerSize: 4 }
}

export function* iterateRecords(buffer: Buffer): Generator<{ header: RecordHeader; data: Buffer; offset: number }> {
  let offset = 0

  while (offset < buffer.length) {
    const header = parseRecordHeader(buffer, offset)
    if (!header) break
    const dataStart = offset + header.headerSize
    const dataEnd = dataStart + header.size

    if (dataEnd > buffer.length) {
      break
    }

    const data = buffer.subarray(dataStart, dataEnd)
    yield { header, data, offset }
    offset = dataEnd
  }
}
