import { controlIdBuffer } from './control-id'
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
  // Minimum 34 bytes to match well-formed Hancom-created TABLE records.
  // Bytes 0-3: flags/properties, bytes 4-5: rows, bytes 6-7: cols,
  // bytes 8+: row sizes and border info (zeroed for minimal valid record).
  const table = Buffer.alloc(34)
  table.writeUInt16LE(rowCount, 4)
  table.writeUInt16LE(colCount, 6)
  return table
}

export function buildCellListHeaderData(col: number, row: number, colSpan: number, rowSpan: number): Buffer {
  // Minimum 46 bytes to match well-formed Hancom-created cell LIST_HEADER records.
  // Bytes 0-3: nPara (paragraph count), bytes 4-7: properties,
  // bytes 8-9: col, bytes 10-11: row, bytes 12-13: colSpan, bytes 14-15: rowSpan,
  // bytes 16+: cell width/height/margins (zeroed for minimal valid record).
  const buf = Buffer.alloc(46)
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

export function buildTableCtrlHeaderData(): Buffer {
  // Minimum 44 bytes to match well-formed Hancom-created table CTRL_HEADER records.
  // Bytes 0-3: control ID ('tbl ' in reversed byte order),
  // bytes 4+: control properties (zeroed for minimal valid record).
  const buf = Buffer.alloc(44)
  controlIdBuffer('tbl ').copy(buf, 0)
  return buf
}
