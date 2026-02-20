import { describe, expect, it } from 'bun:test'
import { iterateRecords, parseRecordHeader } from './record-parser'

describe('parseRecordHeader', () => {
  it('parses normal 4-byte header', () => {
    const header = parseRecordHeader(Buffer.from([0x50, 0x00, 0x10, 0x00]), 0)

    expect(header.tagId).toBe(0x50)
    expect(header.level).toBe(0)
    expect(header.size).toBe(1)
    expect(header.headerSize).toBe(4)
  })

  it('parses extended 8-byte header', () => {
    const packed = (0xfff << 20) >>> 0
    const buffer = Buffer.alloc(8)
    buffer.writeUInt32LE(packed, 0)
    buffer.writeUInt32LE(0x1234, 4)

    const header = parseRecordHeader(buffer, 0)
    expect(header.tagId).toBe(0)
    expect(header.level).toBe(0)
    expect(header.size).toBe(0x1234)
    expect(header.headerSize).toBe(8)
  })
})

describe('iterateRecords', () => {
  it('iterates multiple records correctly', () => {
    const firstHeader = Buffer.from([0x10, 0x00, 0x10, 0x00])
    const firstData = Buffer.from([0xaa])
    const secondHeader = Buffer.from([0x11, 0x00, 0x20, 0x00])
    const secondData = Buffer.from([0xbb, 0xcc])
    const buffer = Buffer.concat([firstHeader, firstData, secondHeader, secondData])

    const records = [...iterateRecords(buffer)]
    expect(records).toHaveLength(2)
    expect(records[0].header.tagId).toBe(0x10)
    expect(records[0].header.size).toBe(1)
    expect(records[0].offset).toBe(0)
    expect(records[0].data).toEqual(firstData)
    expect(records[1].header.tagId).toBe(0x11)
    expect(records[1].header.size).toBe(2)
    expect(records[1].offset).toBe(5)
    expect(records[1].data).toEqual(secondData)
  })
})
