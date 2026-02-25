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

export function buildTableData(rowCount: number, colCount: number): Buffer {
  const table = Buffer.alloc(8)
  table.writeUInt16LE(rowCount, 4)
  table.writeUInt16LE(colCount, 6)
  return table
}

export function buildCellListHeaderData(col: number, row: number, colSpan: number, rowSpan: number): Buffer {
  const buf = Buffer.alloc(32)
  buf.writeInt32LE(1, 0)
  buf.writeUInt32LE(0, 4)
  buf.writeUInt16LE(col, 8)
  buf.writeUInt16LE(row, 10)
  buf.writeUInt16LE(colSpan, 12)
  buf.writeUInt16LE(rowSpan, 14)
  buf.writeUInt32LE(0, 16)
  buf.writeUInt32LE(0, 20)
  return buf
}
