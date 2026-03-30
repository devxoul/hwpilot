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

export function buildTableData(rowCount: number, colCount: number, cellsPerRow?: number[]): Buffer {
  const dynamicSize = 18 + rowCount * 2 + 4
  const table = Buffer.alloc(dynamicSize)
  table.writeUInt32LE(0x04000004, 0)
  table.writeUInt16LE(rowCount, 4)
  table.writeUInt16LE(colCount, 6)
  // Table cell margins (HWPUNIT) — match Hancom defaults
  table.writeUInt16LE(140, 10) // left
  table.writeUInt16LE(140, 12) // right
  table.writeUInt16LE(140, 14) // top
  table.writeUInt16LE(140, 16) // bottom
  // rowSpanCounts: number of cells (LIST_HEADER records) per row
  for (let i = 0; i < rowCount; i++) {
    const count = cellsPerRow?.[i] ?? colCount
    table.writeUInt16LE(count, 18 + i * 2)
  }
  table.writeUInt32LE(1, 18 + rowCount * 2)
  return table
}

export function buildCellListHeaderData(col: number, row: number, colSpan: number, rowSpan: number): Buffer {
  // Minimum 46 bytes to match well-formed Hancom-created cell LIST_HEADER records.
  // Bytes 0-3: nPara (paragraph count), bytes 4-7: properties,
  // bytes 8-9: col, bytes 10-11: row, bytes 12-13: colSpan, bytes 14-15: rowSpan,
  // bytes 16-19: cell width, bytes 20-23: cell height,
  // bytes 24-31: cell margins (left, right, top, bottom as uint16),
  // bytes 32-33: borderFillRef.
  const buf = Buffer.alloc(46)
  buf.writeInt32LE(1, 0) // nPara
  buf.writeUInt32LE(0x20, 4) // properties (Hancom standard)
  buf.writeUInt16LE(col, 8)
  buf.writeUInt16LE(row, 10)
  buf.writeUInt16LE(colSpan, 12)
  buf.writeUInt16LE(rowSpan, 14)
  buf.writeUInt32LE(6432, 16) // default cell width (~8cm)
  buf.writeUInt32LE(500, 20) // default cell height (auto-sized)
  buf.writeUInt16LE(510, 24) // margin left
  buf.writeUInt16LE(510, 26) // margin right
  buf.writeUInt16LE(141, 28) // margin top
  buf.writeUInt16LE(141, 30) // margin bottom
  buf.writeUInt16LE(2, 32) // borderFillRef (1-based; #2 = thin solid border)
  buf.writeUInt32LE(6432, 34)
  return buf
}
// Counter for generating unique table instance IDs within a process
let tableInstanceIdCounter = 0

export function buildTableCtrlHeaderData(): Buffer {
  // Field layout (ShapeObject common header):
  //   [0-3]   Control ID ('tbl ' reversed byte order)
  //   [4-7]   Properties: object placement/wrapping flags
  //   [8-11]  Y offset (int32)
  //   [12-15] X offset (int32)
  //   [16-19] Width (uint32, HWPUNIT)
  //   [20-23] Height (uint32, HWPUNIT)
  //   [24-25] Z-order (int16)
  //   [26-27] Outer spacing/unknown (uint16)
  //   [28-29] Outer margin left (uint16)
  //   [30-31] Outer margin right (uint16)
  //   [32-33] Outer margin top (uint16)
  //   [34-35] Outer margin bottom (uint16)
  //   [36-39] Instance ID (uint32, unique per object)
  //   [40-41] Prevent page break (int16)
  //   [42-43] Description text length (uint16)
  const buf = Buffer.alloc(44)
  controlIdBuffer('tbl ').copy(buf, 0)
  // Properties: 0x082a2211 = standard Hancom table object properties
  // (likeText=1, square wrap, flowWithText, affectLSpacing, protectSize)
  buf.writeUInt32LE(0x082a2211, 4)
  buf.writeUInt32LE(14100, 16) // default table width (~17.6cm, full page width)
  buf.writeUInt32LE(1000, 20) // default table height (auto-sized by Hancom)
  buf.writeUInt16LE(140, 28) // outer margin left
  buf.writeUInt16LE(140, 30) // outer margin right
  buf.writeUInt16LE(140, 32) // outer margin top
  buf.writeUInt16LE(140, 34) // outer margin bottom
  // Instance ID: unique per table object, generated sequentially
  buf.writeUInt32LE(++tableInstanceIdCounter >>> 0, 36)
  return buf
}

// Default page content width: A4 (59528 HWPUNIT) with Hancom default margins (5669 each side)
const DEFAULT_PAGE_CONTENT_WIDTH = 48190

// HWP 5.0 PARA_LINE_SEG binary layout (36 bytes per line segment):
// [0:4] textStartPos  [4:8] lineVerticalPos  [8:12] lineHeight
// [12:16] textPartHeight  [16:20] distanceFromBaseline
// [20:24] lineSpacing  [24:28] columnStart  [28:32] segmentWidth
// [32:34] tag  [34:36] flags
//
// segmentWidth MUST be non-zero (= page content width). A value of 0 causes blank pages
// in non-Hancom viewers. Values are based on Hancom-generated files for 10pt/160% line spacing.
export function buildParaLineSegBuffer(segmentWidth: number = DEFAULT_PAGE_CONTENT_WIDTH): Buffer {
  const safeWidth = segmentWidth > 0 ? segmentWidth : DEFAULT_PAGE_CONTENT_WIDTH
  const buf = Buffer.alloc(36)
  buf.writeUInt32LE(1200, 8) // lineHeight
  buf.writeUInt32LE(1200, 12) // textPartHeight
  buf.writeUInt32LE(1020, 16) // distanceFromBaseline
  buf.writeUInt32LE(960, 20) // lineSpacing
  buf.writeUInt32LE(safeWidth, 28) // segmentWidth (page content width)
  buf.writeUInt16LE(0x0006, 34) // flags
  return buf
}
