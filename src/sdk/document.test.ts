import { describe, expect, it } from 'bun:test'

import { createTestHwpBinary, createTestHwpx } from '@/test-helpers'

import { Document, documentFromBytes } from '@/sdk/document'

describe('documentFromBytes', () => {
  it('creates a Document from HWPX bytes', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello'] })
    const doc = await documentFromBytes(bytes)
    expect(doc).toBeInstanceOf(Document)
    expect(doc.format).toBe('hwpx')
  })

  it('creates a Document from HWP bytes', async () => {
    const bytes = await createTestHwpBinary({ paragraphs: ['Hello'] })
    const doc = await documentFromBytes(bytes)
    expect(doc).toBeInstanceOf(Document)
    expect(doc.format).toBe('hwp')
  })

  it('throws for invalid bytes', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3])
    await expect(documentFromBytes(bytes)).rejects.toThrow()
  })
})

describe('Document.read()', () => {
  it('returns full document structure with no args', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello', 'World'] })
    const doc = await documentFromBytes(bytes)
    const result = doc.read() as { format: string; sections: { paragraphs: unknown[] }[] }
    expect(result.format).toBe('hwpx')
    expect(Array.isArray(result.sections)).toBe(true)
    expect(result.sections[0].paragraphs).toHaveLength(2)
  })

  it('returns specific ref when called with a string ref', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello'] })
    const doc = await documentFromBytes(bytes)
    const result = doc.read('s0.p0')
    expect(result).toBeDefined()
  })

  it('returns paginated result with totalParagraphs when given offset/limit', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['A', 'B', 'C'] })
    const doc = await documentFromBytes(bytes)
    const result = doc.read({ offset: 0, limit: 2 }) as {
      sections: { paragraphs: unknown[]; totalParagraphs: number }[]
    }
    expect(result.sections[0].paragraphs).toHaveLength(2)
    expect(result.sections[0].totalParagraphs).toBe(3)
  })
})

describe('Document.text()', () => {
  it('returns all text with no args', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello', 'World'] })
    const doc = await documentFromBytes(bytes)
    const text = doc.text()
    expect(text).toContain('Hello')
    expect(text).toContain('World')
  })

  it('returns text at ref when called with a string ref', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello', 'World'] })
    const doc = await documentFromBytes(bytes)
    const text = doc.text('s0.p0')
    expect(text).toContain('Hello')
  })
})

describe('Document.find()', () => {
  it('returns matches for a query string', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello World', 'Goodbye'] })
    const doc = await documentFromBytes(bytes)
    const matches = doc.find('Hello')
    expect(Array.isArray(matches)).toBe(true)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('returns empty array when no matches found', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello'] })
    const doc = await documentFromBytes(bytes)
    const matches = doc.find('xyz123notfound')
    expect(Array.isArray(matches)).toBe(true)
    expect(matches).toHaveLength(0)
  })
})

describe('Document.editText()', () => {
  it('edits paragraph text and updates internal state', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Original'] })
    const doc = await documentFromBytes(bytes)
    await doc.editText('s0.p0', 'Updated')
    expect(doc.text()).toContain('Updated')
  })
})

describe('Document.export()', () => {
  it('returns a Uint8Array', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello'] })
    const doc = await documentFromBytes(bytes)
    const exported = await doc.export()
    expect(exported).toBeInstanceOf(Uint8Array)
  })

  it('exported bytes reflect edits after editText()', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Original'] })
    const doc = await documentFromBytes(bytes)
    await doc.editText('s0.p0', 'Modified')
    const exported = await doc.export()
    const reloaded = await documentFromBytes(exported)
    expect(reloaded.text()).toContain('Modified')
  })
})

describe('Document.tableList()', () => {
  it('returns empty array for doc with no tables', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello'] })
    const doc = await documentFromBytes(bytes)
    const tables = doc.tableList()
    expect(Array.isArray(tables)).toBe(true)
    expect(tables).toHaveLength(0)
  })

  it('returns table refs for doc with tables', async () => {
    const bytes = await createTestHwpx({
      tables: [{ rows: [['A', 'B'], ['C', 'D']] }],
    })
    const doc = await documentFromBytes(bytes)
    expect(doc.tableList().length).toBeGreaterThan(0)
  })
})

describe('Document.imageList()', () => {
  it('returns empty array for doc with no images', async () => {
    const bytes = await createTestHwpx({ paragraphs: ['Hello'] })
    const doc = await documentFromBytes(bytes)
    const images = doc.imageList()
    expect(Array.isArray(images)).toBe(true)
    expect(images).toHaveLength(0)
  })
})
