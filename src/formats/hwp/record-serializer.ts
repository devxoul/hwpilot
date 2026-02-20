import { parseRecordHeader } from './record-parser'

export function encodeRecordHeader(tagId: number, level: number, dataSize: number): Buffer {
  if (dataSize >= 0xfff) {
    const header = Buffer.alloc(8)
    const packed = ((tagId & 0x3ff) | ((level & 0x3ff) << 10) | (0xfff << 20)) >>> 0
    header.writeUInt32LE(packed, 0)
    header.writeUInt32LE(dataSize >>> 0, 4)
    return header
  }

  const header = Buffer.alloc(4)
  const packed = ((tagId & 0x3ff) | ((level & 0x3ff) << 10) | ((dataSize & 0xfff) << 20)) >>> 0
  header.writeUInt32LE(packed, 0)
  return header
}

export function buildRecord(tagId: number, level: number, data: Buffer): Buffer {
  const header = encodeRecordHeader(tagId, level, data.length)
  return Buffer.concat([header, data])
}

export function replaceRecordData(stream: Buffer, recordOffset: number, newData: Buffer): Buffer {
  const header = parseRecordHeader(stream, recordOffset)
  const oldTotalSize = header.headerSize + header.size
  const newHeader = encodeRecordHeader(header.tagId, header.level, newData.length)

  return Buffer.concat([
    stream.subarray(0, recordOffset),
    newHeader,
    newData,
    stream.subarray(recordOffset + oldTotalSize),
  ])
}
