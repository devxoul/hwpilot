import { describe, expect, it } from 'bun:test'
import { controlIdBuffer, readControlId } from './control-id'

describe('readControlId', () => {
  it('reads table control ID from reversed bytes', () => {
    const buffer = Buffer.from([0x20, 0x6c, 0x62, 0x74])
    expect(readControlId(buffer)).toBe('tbl ')
  })

  it('reads gso control ID from reversed bytes', () => {
    const buffer = Buffer.from([0x20, 0x6f, 0x73, 0x67])
    expect(readControlId(buffer)).toBe('gso ')
  })

  it('reads $rec control ID from reversed bytes', () => {
    const buffer = Buffer.from([0x63, 0x65, 0x72, 0x24])
    expect(readControlId(buffer)).toBe('$rec')
  })

  it('reads secd control ID from reversed bytes', () => {
    const buffer = Buffer.from([0x64, 0x63, 0x65, 0x73])
    expect(readControlId(buffer)).toBe('secd')
  })

  it('reads cold control ID from reversed bytes', () => {
    const buffer = Buffer.from([0x64, 0x6c, 0x6f, 0x63])
    expect(readControlId(buffer)).toBe('cold')
  })

  it('respects offset parameter', () => {
    const buffer = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x20, 0x6c, 0x62, 0x74])
    expect(readControlId(buffer, 4)).toBe('tbl ')
  })

  it('reads from offset 0 by default', () => {
    const buffer = Buffer.from([0x20, 0x6c, 0x62, 0x74, 0xff, 0xff, 0xff, 0xff])
    expect(readControlId(buffer)).toBe('tbl ')
  })
})

describe('controlIdBuffer', () => {
  it('creates reversed buffer for table control ID', () => {
    const buffer = controlIdBuffer('tbl ')
    expect(buffer).toEqual(Buffer.from([0x20, 0x6c, 0x62, 0x74]))
  })

  it('creates reversed buffer for gso control ID', () => {
    const buffer = controlIdBuffer('gso ')
    expect(buffer).toEqual(Buffer.from([0x20, 0x6f, 0x73, 0x67]))
  })

  it('creates reversed buffer for $rec control ID', () => {
    const buffer = controlIdBuffer('$rec')
    expect(buffer).toEqual(Buffer.from([0x63, 0x65, 0x72, 0x24]))
  })

  it('creates reversed buffer for secd control ID', () => {
    const buffer = controlIdBuffer('secd')
    expect(buffer).toEqual(Buffer.from([0x64, 0x63, 0x65, 0x73]))
  })

  it('creates reversed buffer for cold control ID', () => {
    const buffer = controlIdBuffer('cold')
    expect(buffer).toEqual(Buffer.from([0x64, 0x6c, 0x6f, 0x63]))
  })
})

describe('round-trip: readControlId ↔ controlIdBuffer', () => {
  const testIds = ['tbl ', 'gso ', '$rec', 'secd', 'cold']

  testIds.forEach((id) => {
    it(`round-trip for ${id}`, () => {
      const buffer = controlIdBuffer(id)
      const readBack = readControlId(buffer)
      expect(readBack).toBe(id)
    })
  })
})
