import { describe, expect, it } from 'bun:test'

import { parseCellAddress, parseStyleRefs } from './docinfo-parser'

function buildStyleBuffer(opts: {
  koreanName?: string
  englishName?: string
  charShapeRef: number
  paraShapeRef: number
  extended?: boolean
}): Buffer {
  const { koreanName = '', englishName = '', charShapeRef, paraShapeRef, extended = false } = opts

  const koreanNameBuf = Buffer.from(koreanName, 'utf16le')
  const englishNameBuf = Buffer.from(englishName, 'utf16le')

  const parts: Buffer[] = []
  const korLenBuf = Buffer.alloc(2)
  korLenBuf.writeUInt16LE(koreanName.length, 0)
  parts.push(korLenBuf)
  parts.push(koreanNameBuf)

  const engLenBuf = Buffer.alloc(2)
  engLenBuf.writeUInt16LE(englishName.length, 0)
  parts.push(engLenBuf)
  parts.push(englishNameBuf)

  if (extended) {
    const extBuf = Buffer.alloc(10)
    extBuf.writeUInt32LE(0, 0)
    extBuf.writeUInt16LE(charShapeRef, 4)
    extBuf.writeUInt16LE(paraShapeRef, 6)
    parts.push(extBuf)
  } else {
    const shortBuf = Buffer.alloc(4)
    shortBuf.writeUInt16LE(charShapeRef, 0)
    shortBuf.writeUInt16LE(paraShapeRef, 2)
    parts.push(shortBuf)
  }

  return Buffer.concat(parts)
}

describe('parseStyleRefs', () => {
  describe('short format (remaining >= 4)', () => {
    it('returns correct charShapeRef and paraShapeRef', () => {
      // given
      const data = buildStyleBuffer({ charShapeRef: 5, paraShapeRef: 7 })

      // when
      const result = parseStyleRefs(data)

      // then
      expect(result).toEqual({ charShapeRef: 5, paraShapeRef: 7 })
    })

    it('handles non-zero names and still reads refs correctly', () => {
      // given
      const data = buildStyleBuffer({ koreanName: '본문', englishName: 'Body', charShapeRef: 3, paraShapeRef: 2 })

      // when
      const result = parseStyleRefs(data)

      // then
      expect(result).toEqual({ charShapeRef: 3, paraShapeRef: 2 })
    })
  })

  describe('extended format (remaining >= 10)', () => {
    it('reads charShapeRef from offset+4 and paraShapeRef from offset+6', () => {
      // given
      const data = buildStyleBuffer({ charShapeRef: 12, paraShapeRef: 99, extended: true })

      // when
      const result = parseStyleRefs(data)

      // then
      expect(result).toEqual({ charShapeRef: 12, paraShapeRef: 99 })
    })

    it('handles named styles in extended format', () => {
      // given
      const data = buildStyleBuffer({ koreanName: '개요 1', charShapeRef: 7, paraShapeRef: 4, extended: true })

      // when
      const result = parseStyleRefs(data)

      // then
      expect(result).toEqual({ charShapeRef: 7, paraShapeRef: 4 })
    })
  })

  describe('truncated / invalid data', () => {
    it('returns null for empty buffer', () => {
      expect(parseStyleRefs(Buffer.alloc(0))).toBeNull()
    })

    it('returns null when remaining < 4 after names', () => {
      // given - 4 bytes header (2 zero lengths) + 3 bytes payload (< 4 remaining)
      const data = Buffer.alloc(7)
      data.writeUInt16LE(0, 0)
      data.writeUInt16LE(0, 2)

      // when
      const result = parseStyleRefs(data)

      // then
      expect(result).toBeNull()
    })

    it('returns null when name length exceeds buffer', () => {
      // given - claims koreanNameLen = 100 but buffer is tiny
      const data = Buffer.alloc(4)
      data.writeUInt16LE(100, 0)

      // when
      const result = parseStyleRefs(data)

      // then
      expect(result).toBeNull()
    })
  })

  describe('cross-subsystem agreement (parseStyleRefs)', () => {
    it('short format: agrees with original reader.ts logic', () => {
      // given - buffer matching reader.ts path (remaining >= 4, < 10)
      const data = buildStyleBuffer({ charShapeRef: 42, paraShapeRef: 17 })
      const nameLen = data.readUInt16LE(0)
      let offset = 2 + nameLen * 2
      const englishNameLen = data.readUInt16LE(offset)
      offset += 2 + englishNameLen * 2
      const remaining = data.length - offset

      // when
      const result = parseStyleRefs(data)

      // then - replicates reader.ts inline logic
      expect(remaining).toBeGreaterThanOrEqual(4)
      expect(remaining).toBeLessThan(10)
      const expectedCharShapeRef = data.readUInt16LE(offset)
      const expectedParaShapeRef = data.readUInt16LE(offset + 2)
      expect(result?.charShapeRef).toBe(expectedCharShapeRef)
      expect(result?.paraShapeRef).toBe(expectedParaShapeRef)
    })

    it('extended format: agrees with original mutator.ts logic', () => {
      // given - buffer matching mutator.ts path (remaining >= 10)
      const data = buildStyleBuffer({ charShapeRef: 8, paraShapeRef: 3, extended: true })
      const nameLen = data.readUInt16LE(0)
      let offset = 2 + nameLen * 2
      const englishNameLen = data.readUInt16LE(offset)
      offset += 2 + englishNameLen * 2
      const remaining = data.length - offset

      // when
      const result = parseStyleRefs(data)

      // then - replicates mutator.ts parseStyleParaShapeRef / parseStyleCharShapeRef logic
      expect(remaining).toBeGreaterThanOrEqual(10)
      const expectedCharShapeRef = data.readUInt16LE(offset + 4)
      const expectedParaShapeRef = data.readUInt16LE(offset + 6)
      expect(result?.charShapeRef).toBe(expectedCharShapeRef)
      expect(result?.paraShapeRef).toBe(expectedParaShapeRef)
    })
  })
})

describe('parseCellAddress', () => {
  function buildCellBuffer(opts: {
    headerSize: 6 | 8
    col: number
    row: number
    colSpan: number
    rowSpan: number
  }): Buffer {
    const { headerSize, col, row, colSpan, rowSpan } = opts
    const totalSize = headerSize === 6 ? 30 : headerSize + 8
    const buf = Buffer.alloc(totalSize)
    buf.writeUInt16LE(col, headerSize)
    buf.writeUInt16LE(row, headerSize + 2)
    buf.writeUInt16LE(colSpan, headerSize + 4)
    buf.writeUInt16LE(rowSpan, headerSize + 6)
    return buf
  }

  describe('30-byte LIST_HEADER (commonHeaderSize=6)', () => {
    it('reads col, row, colSpan, rowSpan from correct offsets', () => {
      // given
      const data = buildCellBuffer({ headerSize: 6, col: 2, row: 3, colSpan: 1, rowSpan: 2 })

      // when
      const result = parseCellAddress(data)

      // then
      expect(result).toEqual({ col: 2, row: 3, colSpan: 1, rowSpan: 2 })
    })
  })

  describe('standard LIST_HEADER (commonHeaderSize=8)', () => {
    it('reads col, row, colSpan, rowSpan from correct offsets', () => {
      // given
      const data = buildCellBuffer({ headerSize: 8, col: 0, row: 1, colSpan: 3, rowSpan: 1 })

      // when
      const result = parseCellAddress(data)

      // then
      expect(result).toEqual({ col: 0, row: 1, colSpan: 3, rowSpan: 1 })
    })
  })

  describe('truncated data', () => {
    it('returns null when buffer is too short for standard header', () => {
      // given - 8 + 7 = 15 bytes, needs 8 + 8 = 16
      const data = Buffer.alloc(15)

      // when
      const result = parseCellAddress(data)

      // then
      expect(result).toBeNull()
    })

    it('returns null when 30-byte buffer has insufficient payload', () => {
      // given - 29 bytes: length !== 30, so commonHeaderSize=8, needs 16 bytes but 29 >= 16 — use 13 bytes instead
      const data = Buffer.alloc(13)

      // when
      const result = parseCellAddress(data)

      // then
      expect(result).toBeNull()
    })
  })

  describe('cross-subsystem agreement', () => {
    it('30-byte layout: agrees with original reader.ts logic', () => {
      // given
      const data = buildCellBuffer({ headerSize: 6, col: 5, row: 7, colSpan: 2, rowSpan: 3 })
      const commonHeaderSize = data.length === 30 ? 6 : 8

      // when
      const result = parseCellAddress(data)

      // then - replicates reader.ts inline logic
      expect(result?.col).toBe(data.readUInt16LE(commonHeaderSize))
      expect(result?.row).toBe(data.readUInt16LE(commonHeaderSize + 2))
      expect(result?.colSpan).toBe(data.readUInt16LE(commonHeaderSize + 4))
      expect(result?.rowSpan).toBe(data.readUInt16LE(commonHeaderSize + 6))
    })

    it('standard layout: agrees with original mutator.ts logic (col and row only)', () => {
      // given
      const data = buildCellBuffer({ headerSize: 8, col: 1, row: 4, colSpan: 1, rowSpan: 1 })
      const commonHeaderSize = data.length === 30 ? 6 : 8

      // when
      const result = parseCellAddress(data)

      // then - replicates mutator.ts inline logic (col and row)
      expect(result?.col).toBe(data.readUInt16LE(commonHeaderSize))
      expect(result?.row).toBe(data.readUInt16LE(commonHeaderSize + 2))
    })
  })
})
