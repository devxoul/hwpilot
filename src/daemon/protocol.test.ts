import { describe, expect, it } from 'bun:test'
import { createMessageReader, encodeMessage } from './protocol'

function collect(encoded: Buffer): unknown[] {
  const results: unknown[] = []
  const reader = createMessageReader((msg) => results.push(msg))
  reader(encoded)
  return results
}

describe('encodeMessage + createMessageReader', () => {
  it('round-trips a simple object', () => {
    const obj = { hello: 'world', n: 42 }
    const results = collect(encodeMessage(obj))
    expect(results).toEqual([obj])
  })

  it('handles chunked delivery', () => {
    const obj = { key: 'value', nested: { a: 1 } }
    const encoded = encodeMessage(obj)
    const mid = Math.floor(encoded.length / 2)
    const chunk1 = encoded.subarray(0, mid)
    const chunk2 = encoded.subarray(mid)

    const results: unknown[] = []
    const reader = createMessageReader((msg) => results.push(msg))
    reader(chunk1)
    expect(results).toHaveLength(0)
    reader(chunk2)
    expect(results).toEqual([obj])
  })

  it('handles multiple messages in one chunk', () => {
    const a = { msg: 'first' }
    const b = { msg: 'second' }
    const combined = Buffer.concat([encodeMessage(a), encodeMessage(b)])
    const results = collect(combined)
    expect(results).toEqual([a, b])
  })

  it('round-trips UTF-8 Korean text', () => {
    const obj = { text: '안녕하세요 한글 문서' }
    const results = collect(encodeMessage(obj))
    expect(results).toEqual([obj])
  })

  it('round-trips an empty object', () => {
    const results = collect(encodeMessage({}))
    expect(results).toEqual([{}])
  })

  it('round-trips a complex nested object', () => {
    const obj = {
      success: false,
      error: 'not found',
      context: { ref: 's0.p999', file: 'doc.hwp' },
      hint: 'Valid refs: s0.p0 through s0.p49',
    }
    const results = collect(encodeMessage(obj))
    expect(results).toEqual([obj])
  })

  it('round-trips a large message', () => {
    const obj = { data: 'x'.repeat(100_000) }
    const results = collect(encodeMessage(obj))
    expect(results).toEqual([obj])
  })

  it('buffers partial length header', () => {
    const encoded = encodeMessage({ partial: true })
    const results: unknown[] = []
    const reader = createMessageReader((msg) => results.push(msg))

    // send only 2 bytes of the 4-byte header
    reader(encoded.subarray(0, 2))
    expect(results).toHaveLength(0)

    // send the rest
    reader(encoded.subarray(2))
    expect(results).toEqual([{ partial: true }])
  })

  it('handles three messages delivered byte-by-byte', () => {
    const objects = [{ a: 1 }, { b: 2 }, { c: 3 }]
    const encoded = Buffer.concat(objects.map(encodeMessage))
    const results: unknown[] = []
    const reader = createMessageReader((msg) => results.push(msg))

    for (let i = 0; i < encoded.length; i++) {
      reader(encoded.subarray(i, i + 1))
    }
    expect(results).toEqual(objects)
  })

  it('throws on oversized message', () => {
    const header = Buffer.alloc(4)
    header.writeUInt32BE(128 * 1024 * 1024, 0) // 128 MB > 64 MB limit
    const reader = createMessageReader(() => {})
    expect(() => reader(header)).toThrow('Message too large')
  })
})
