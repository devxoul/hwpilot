import { describe, expect, it } from 'bun:test'
import { createTestHwpCfb, createTestHwpx } from '@/test-helpers'
import { detectFormatFromBuffer } from './format-detector'

describe('detectFormatFromBuffer', () => {
  it('detects HWPX (ZIP) format', async () => {
    const buffer = await createTestHwpx()
    expect(detectFormatFromBuffer(buffer)).toBe('hwpx')
  })

  it('detects HWP 5.0 (CFB) format', () => {
    const buffer = createTestHwpCfb()
    expect(detectFormatFromBuffer(buffer)).toBe('hwp')
  })

  it('throws for unsupported format', () => {
    const buffer = Buffer.from('not a valid file format')
    expect(() => detectFormatFromBuffer(buffer)).toThrow('Unsupported file format')
  })

  it('throws for too-small file', () => {
    const buffer = Buffer.from([0x50, 0x4b])
    expect(() => detectFormatFromBuffer(buffer)).toThrow('File too small')
  })
})
