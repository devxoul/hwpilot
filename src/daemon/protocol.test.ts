import { describe, expect, it } from 'bun:test'
import { createMessageReader, DaemonRequest, DaemonResponse, encodeMessage } from './protocol'

describe('protocol', () => {
  describe('encodeMessage', () => {
    it('single message round-trip', () => {
      const obj = { token: 'abc123', command: 'read', args: { file: 'doc.hwpx' } }
      const encoded = encodeMessage(obj)

      const length = encoded.readUInt32BE(0)
      const json = encoded.slice(4).toString('utf-8')
      const decoded = JSON.parse(json)

      expect(decoded).toEqual(obj)
      expect(length).toBe(encoded.length - 4)
    })

    it('empty object', () => {
      const obj = {}
      const encoded = encodeMessage(obj)

      const length = encoded.readUInt32BE(0)
      const json = encoded.slice(4).toString('utf-8')
      const decoded = JSON.parse(json)

      expect(decoded).toEqual(obj)
      expect(length).toBe(2) // "{}"
    })

    it('complex nested object', () => {
      const obj = {
        token: 'xyz',
        command: 'edit',
        args: {
          ref: 's0.p0',
          format: { bold: true, size: 16, color: '#FF0000' },
          nested: { deep: { value: 42 } },
        },
      }
      const encoded = encodeMessage(obj)

      const length = encoded.readUInt32BE(0)
      const json = encoded.slice(4).toString('utf-8')
      const decoded = JSON.parse(json)

      expect(decoded).toEqual(obj)
      expect(length).toBe(encoded.length - 4)
    })

    it('UTF-8 Korean text', () => {
      const obj = { text: '안녕하세요 한글 문서' }
      const encoded = encodeMessage(obj)

      const length = encoded.readUInt32BE(0)
      const json = encoded.slice(4).toString('utf-8')
      const decoded = JSON.parse(json)

      expect(decoded).toEqual(obj)
      expect(decoded.text).toBe('안녕하세요 한글 문서')
      expect(length).toBe(encoded.length - 4)
    })

    it('large message', () => {
      const largeString = 'x'.repeat(100000)
      const obj = { data: largeString }
      const encoded = encodeMessage(obj)

      const length = encoded.readUInt32BE(0)
      const json = encoded.slice(4).toString('utf-8')
      const decoded = JSON.parse(json)

      expect(decoded.data).toBe(largeString)
      expect(length).toBe(encoded.length - 4)
    })
  })

  describe('createMessageReader', () => {
    it('single message round-trip', () => {
      const messages: unknown[] = []
      const reader = createMessageReader((msg) => messages.push(msg))

      const obj = { token: 'abc', command: 'read' }
      const encoded = encodeMessage(obj)
      reader(encoded)

      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual(obj)
    })

    it('chunked delivery - split across two buffers', () => {
      const messages: unknown[] = []
      const reader = createMessageReader((msg) => messages.push(msg))

      const obj = { token: 'abc', command: 'read' }
      const encoded = encodeMessage(obj)

      const mid = Math.floor(encoded.length / 2)
      const chunk1 = encoded.slice(0, mid)
      const chunk2 = encoded.slice(mid)

      reader(chunk1)
      expect(messages).toHaveLength(0)

      reader(chunk2)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual(obj)
    })

    it('multiple messages in one chunk', () => {
      const messages: unknown[] = []
      const reader = createMessageReader((msg) => messages.push(msg))

      const obj1 = { id: 1, text: 'first' }
      const obj2 = { id: 2, text: 'second' }
      const obj3 = { id: 3, text: 'third' }

      const encoded1 = encodeMessage(obj1)
      const encoded2 = encodeMessage(obj2)
      const encoded3 = encodeMessage(obj3)

      const combined = Buffer.concat([encoded1, encoded2, encoded3])
      reader(combined)

      expect(messages).toHaveLength(3)
      expect(messages[0]).toEqual(obj1)
      expect(messages[1]).toEqual(obj2)
      expect(messages[2]).toEqual(obj3)
    })

    it('UTF-8 Korean text', () => {
      const messages: unknown[] = []
      const reader = createMessageReader((msg) => messages.push(msg))

      const obj = { text: '안녕하세요 한글 문서' }
      const encoded = encodeMessage(obj)
      reader(encoded)

      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual(obj)
      expect((messages[0] as Record<string, unknown>).text).toBe('안녕하세요 한글 문서')
    })

    it('partial message handling', () => {
      const messages: unknown[] = []
      const reader = createMessageReader((msg) => messages.push(msg))

      const obj1 = { id: 1 }
      const obj2 = { id: 2 }

      const encoded1 = encodeMessage(obj1)
      const encoded2 = encodeMessage(obj2)

      const chunk1 = encoded1.slice(0, 2)
      const chunk2 = Buffer.concat([encoded1.slice(2), encoded2.slice(0, 3)])
      const chunk3 = encoded2.slice(3)

      reader(chunk1)
      expect(messages).toHaveLength(0)

      reader(chunk2)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual(obj1)

      reader(chunk3)
      expect(messages).toHaveLength(2)
      expect(messages[1]).toEqual(obj2)
    })

    it('DaemonRequest type', () => {
      const messages: unknown[] = []
      const reader = createMessageReader((msg) => messages.push(msg))

      const request: DaemonRequest = {
        token: 'auth-token-123',
        command: 'read',
        args: { file: 'document.hwpx', limit: 20 },
      }

      const encoded = encodeMessage(request)
      reader(encoded)

      expect(messages).toHaveLength(1)
      const decoded = messages[0] as DaemonRequest
      expect(decoded.token).toBe('auth-token-123')
      expect(decoded.command).toBe('read')
      expect(decoded.args.file).toBe('document.hwpx')
    })

    it('DaemonResponse success type', () => {
      const messages: unknown[] = []
      const reader = createMessageReader((msg) => messages.push(msg))

      const response: DaemonResponse = {
        success: true,
        data: { paragraphs: [{ ref: 's0.p0', text: 'Hello' }] },
      }

      const encoded = encodeMessage(response)
      reader(encoded)

      expect(messages).toHaveLength(1)
      const decoded = messages[0] as DaemonResponse
      expect(decoded.success).toBe(true)
      if (decoded.success) {
        expect(decoded.data).toBeDefined()
      }
    })

    it('DaemonResponse error type', () => {
      const messages: unknown[] = []
      const reader = createMessageReader((msg) => messages.push(msg))

      const response: DaemonResponse = {
        success: false,
        error: 'File not found',
        context: { file: 'missing.hwpx' },
        hint: 'Check file path',
      }

      const encoded = encodeMessage(response)
      reader(encoded)

      expect(messages).toHaveLength(1)
      const decoded = messages[0] as DaemonResponse
      expect(decoded.success).toBe(false)
      if (!decoded.success) {
        expect(decoded.error).toBe('File not found')
        expect(decoded.context).toEqual({ file: 'missing.hwpx' })
        expect(decoded.hint).toBe('Check file path')
      }
    })
  })
})
