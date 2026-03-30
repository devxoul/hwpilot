import { describe, expect, it } from 'bun:test'

import { createTestHwpBinary, createTestHwpx } from '@/test-helpers'

import { Document, detectFormat, loadDocument } from '@/sdk/index'

describe('loadDocument()', () => {
  it('returns a Document instance from HWPX bytes', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello'] })
    const doc = await loadDocument(bytes)
    expect(doc).toBeInstanceOf(Document)
    expect(doc.format).toBe('hwpx')
  })

  it('returns a Document instance from HWP bytes', async () => {
    const bytes = await createTestHwpBinary({ paragraphs: ['Hello'] })
    const doc = await loadDocument(bytes)
    expect(doc).toBeInstanceOf(Document)
    expect(doc.format).toBe('hwp')
  })

  it('returned Document has read, text, find, and export methods', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello'] })
    const doc = await loadDocument(bytes)
    expect(typeof doc.read).toBe('function')
    expect(typeof doc.text).toBe('function')
    expect(typeof doc.find).toBe('function')
    expect(typeof doc.export).toBe('function')
  })
})

describe('detectFormat()', () => {
  it('returns hwpx for HWPX bytes', async () => {
    const bytes = await createTestHwpx()
    expect(detectFormat(bytes)).toBe('hwpx')
  })

  it('returns hwp for HWP bytes', async () => {
    const bytes = await createTestHwpBinary()
    expect(detectFormat(bytes)).toBe('hwp')
  })
})
