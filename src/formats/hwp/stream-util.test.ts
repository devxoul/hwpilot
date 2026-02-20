import { describe, expect, it } from 'bun:test'
import { compressStream, decompressStream, getCompressionFlag, setCompressionFlag } from './stream-util'

describe('compressStream / decompressStream', () => {
  it('round-trip produces byte-identical buffer', () => {
    // given
    const original = Buffer.from('Hello, HWP world! 안녕하세요.')

    // when
    const compressed = compressStream(original)
    const decompressed = decompressStream(compressed)

    // then
    expect(decompressed).toEqual(original)
  })

  it('handles empty buffer without throwing', () => {
    // given
    const empty = Buffer.alloc(0)

    // when / then
    expect(() => compressStream(empty)).not.toThrow()
    expect(() => decompressStream(compressStream(empty))).not.toThrow()
  })

  it('compressStream returns a Buffer', () => {
    const result = compressStream(Buffer.from('test'))
    expect(result).toBeInstanceOf(Buffer)
  })

  it('decompressStream returns a Buffer', () => {
    const compressed = compressStream(Buffer.from('test'))
    const result = decompressStream(compressed)
    expect(result).toBeInstanceOf(Buffer)
  })
})

describe('getCompressionFlag', () => {
  it('returns true when bit 0x1 is set in flags at offset 36', () => {
    // given
    const header = Buffer.alloc(40)
    header.writeUInt32LE(0x1, 36)

    // when
    const result = getCompressionFlag(header)

    // then
    expect(result).toBe(true)
  })

  it('returns false when bit 0x1 is not set in flags at offset 36', () => {
    // given
    const header = Buffer.alloc(40)
    header.writeUInt32LE(0x0, 36)

    // when
    const result = getCompressionFlag(header)

    // then
    expect(result).toBe(false)
  })

  it('returns true when flags has 0x1 among other bits', () => {
    // given
    const header = Buffer.alloc(40)
    header.writeUInt32LE(0xff, 36)

    // when
    const result = getCompressionFlag(header)

    // then
    expect(result).toBe(true)
  })

  it('returns false when only other bits are set (not 0x1)', () => {
    // given
    const header = Buffer.alloc(40)
    header.writeUInt32LE(0x2, 36)

    // when
    const result = getCompressionFlag(header)

    // then
    expect(result).toBe(false)
  })
})

describe('setCompressionFlag', () => {
  it('sets bit 0x1 when compressed=true', () => {
    // given
    const header = Buffer.alloc(40)
    header.writeUInt32LE(0x0, 36)

    // when
    setCompressionFlag(header, true)

    // then
    const flags = header.readUInt32LE(36)
    expect(Boolean(flags & 0x1)).toBe(true)
  })

  it('clears bit 0x1 when compressed=false', () => {
    // given
    const header = Buffer.alloc(40)
    header.writeUInt32LE(0x1, 36)

    // when
    setCompressionFlag(header, false)

    // then
    const flags = header.readUInt32LE(36)
    expect(Boolean(flags & 0x1)).toBe(false)
  })

  it('preserves other bits when setting compression flag', () => {
    // given
    const header = Buffer.alloc(40)
    header.writeUInt32LE(0x6, 36)

    // when
    setCompressionFlag(header, true)

    // then
    const flags = header.readUInt32LE(36)
    expect(flags & 0x6).toBe(0x6)
    expect(Boolean(flags & 0x1)).toBe(true)
  })

  it('preserves other bits when clearing compression flag', () => {
    // given
    const header = Buffer.alloc(40)
    header.writeUInt32LE(0x7, 36)

    // when
    setCompressionFlag(header, false)

    // then
    const flags = header.readUInt32LE(36)
    expect(flags & 0x6).toBe(0x6)
    expect(Boolean(flags & 0x1)).toBe(false)
  })

  it('mutates the buffer in place', () => {
    // given
    const header = Buffer.alloc(40)
    const original = header

    // when
    setCompressionFlag(header, true)

    // then
    expect(header).toBe(original)
  })
})
