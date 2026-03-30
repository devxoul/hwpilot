// Canonical STYLE record parser shared by reader, mutator, validator, and creator.
// STYLE record layout:
//   [uint16 koreanNameLen][koreanName (UTF-16LE)][uint16 englishNameLen][englishName (UTF-16LE)]
//   followed by either:
//   - Extended format (remaining >= 10): [4 bytes padding][uint16 charShapeRef][uint16 paraShapeRef]
//   - Short format   (remaining >= 4):                    [uint16 charShapeRef][uint16 paraShapeRef]
export function parseStyleRefs(data: Buffer): { charShapeRef: number; paraShapeRef: number } | null {
  if (data.length < 2) return null
  const nameLen = data.readUInt16LE(0)
  let offset = 2 + nameLen * 2
  if (offset + 2 > data.length) return null
  const englishNameLen = data.readUInt16LE(offset)
  offset += 2 + englishNameLen * 2
  const remaining = data.length - offset
  if (remaining >= 10) {
    return {
      charShapeRef: data.readUInt16LE(offset + 4),
      paraShapeRef: data.readUInt16LE(offset + 6),
    }
  }
  if (remaining >= 4) {
    return {
      charShapeRef: data.readUInt16LE(offset),
      paraShapeRef: data.readUInt16LE(offset + 2),
    }
  }
  return null
}

// Canonical CELL_LIST_HEADER address parser shared by reader and mutator.
// LIST_HEADER layout has a commonHeaderSize that varies by record size:
//   - 30-byte record: commonHeaderSize = 6
//   - standard record: commonHeaderSize = 8
// col, row, colSpan, rowSpan are at offsets commonHeaderSize+0/+2/+4/+6 (uint16LE each).
export function parseCellAddress(data: Buffer): { col: number; row: number; colSpan: number; rowSpan: number } | null {
  const commonHeaderSize = data.length === 30 ? 6 : 8
  if (data.length < commonHeaderSize + 8) return null
  return {
    col: data.readUInt16LE(commonHeaderSize),
    row: data.readUInt16LE(commonHeaderSize + 2),
    colSpan: data.readUInt16LE(commonHeaderSize + 4),
    rowSpan: data.readUInt16LE(commonHeaderSize + 6),
  }
}
