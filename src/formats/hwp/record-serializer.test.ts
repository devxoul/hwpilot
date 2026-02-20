import { describe, expect, it } from 'bun:test'
import { parseRecordHeader } from './record-parser'
import { buildRecord, encodeRecordHeader, replaceRecordData } from './record-serializer'

describe('encodeRecordHeader', () => {
  it('encodes standard 4-byte header and round-trips with parser', () => {
    const encoded = encodeRecordHeader(0x155, 0x2a, 0x234)

    expect(encoded).toHaveLength(4)

    const packed = encoded.readUInt32LE(0)
    expect(packed).toBe((0x155 | (0x2a << 10) | (0x234 << 20)) >>> 0)

    const parsed = parseRecordHeader(encoded, 0)
    expect(parsed.tagId).toBe(0x155)
    expect(parsed.level).toBe(0x2a)
    expect(parsed.size).toBe(0x234)
    expect(parsed.headerSize).toBe(4)
  })

  it('encodes extended 8-byte header for large data and round-trips with parser', () => {
    const encoded = encodeRecordHeader(0x20, 0x1, 0x1234)

    expect(encoded).toHaveLength(8)
    const packed = encoded.readUInt32LE(0)
    expect((packed >> 20) & 0xfff).toBe(0xfff)
    expect(encoded.readUInt32LE(4)).toBe(0x1234)

    const parsed = parseRecordHeader(encoded, 0)
    expect(parsed.tagId).toBe(0x20)
    expect(parsed.level).toBe(0x1)
    expect(parsed.size).toBe(0x1234)
    expect(parsed.headerSize).toBe(8)
  })
})

describe('buildRecord', () => {
  it('builds a record as encoded header plus raw data', () => {
    const data = Buffer.from([0xaa, 0xbb, 0xcc])
    const record = buildRecord(0x11, 0x2, data)

    const parsed = parseRecordHeader(record, 0)
    expect(parsed.tagId).toBe(0x11)
    expect(parsed.level).toBe(0x2)
    expect(parsed.size).toBe(3)
    expect(record.subarray(parsed.headerSize)).toEqual(data)
  })
})

describe('replaceRecordData', () => {
  it('replaces middle record and preserves surrounding records byte-identical', () => {
    const record1 = buildRecord(0x10, 0, Buffer.from([0x01]))
    const record2 = buildRecord(0x11, 1, Buffer.from([0x02, 0x03]))
    const record3 = buildRecord(0x12, 0, Buffer.from([0x04, 0x05, 0x06]))
    const stream = Buffer.concat([record1, record2, record3])

    const middleOffset = record1.length
    const replaced = replaceRecordData(stream, middleOffset, Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]))

    const newRecord1 = replaced.subarray(0, record1.length)
    const newRecord2Start = record1.length
    const newRecord2Header = parseRecordHeader(replaced, newRecord2Start)
    const newRecord2End = newRecord2Start + newRecord2Header.headerSize + newRecord2Header.size
    const newRecord3 = replaced.subarray(newRecord2End)

    expect(Buffer.compare(newRecord1, record1)).toBe(0)
    expect(newRecord2Header.tagId).toBe(0x11)
    expect(newRecord2Header.level).toBe(1)
    expect(newRecord2Header.size).toBe(4)
    expect(replaced.subarray(newRecord2Start + newRecord2Header.headerSize, newRecord2End)).toEqual(
      Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]),
    )
    expect(Buffer.compare(newRecord3, record3)).toBe(0)
  })
})
