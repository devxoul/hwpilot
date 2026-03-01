import { describe, expect, it } from 'bun:test'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import CFB from 'cfb'
import JSZip from 'jszip'
import { convertCommand } from '../../commands/convert'
import { createTestHwpBinary } from '../../test-helpers'
import { createHwp } from './creator'
import { getEntryBuffer, mutateHwpCfb } from './mutator'
import { loadHwp } from './reader'
import { iterateRecords } from './record-parser'
import { getCompressionFlag } from './stream-util'
import { TAG } from './tag-ids'

const fixture = 'e2e/fixtures/임금 등 청구의 소.hwp'
const tmpPath = (name: string) => join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.hwp`)

async function getParagraphCharShapeData(
  cfb: CFB.CFB$Container,
  compressed: boolean,
  paragraphTarget: number,
): Promise<Buffer | null> {
  let sectionStream = getEntryBuffer(cfb, '/BodyText/Section0')
  if (compressed) {
    const { decompressStream } = await import('./stream-util')
    sectionStream = decompressStream(sectionStream)
  }

  let paragraphIndex = -1
  for (const { header, data } of iterateRecords(sectionStream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      paragraphIndex += 1
      continue
    }

    if (paragraphIndex === paragraphTarget && header.tagId === TAG.PARA_CHAR_SHAPE) {
      return data
    }
  }

  return null
}

describe('mutateHwpCfb', () => {
  it('applies setText to first paragraph in-memory', async () => {
    const buf = await readFile(fixture)
    const cfb = CFB.read(buf, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'setText', ref: 's0.p0', text: 'MUTATED' }], compressed)

    // write to temp, read back independently
    const outPath = tmpPath('mutator-setText')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const doc = await loadHwp(outPath)
      const firstText = doc.sections[0].paragraphs[0].runs.map((r) => r.text).join('')
      expect(firstText).toBe('MUTATED')
    } finally {
      await unlink(outPath)
    }
  })

  it('no-ops on empty operations', async () => {
    const buf = await readFile(fixture)
    const cfb = CFB.read(buf, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    // should not throw
    mutateHwpCfb(cfb, [], compressed)
  })

  it('preserves non-target paragraphs', async () => {
    const buf = await readFile(fixture)
    const cfb = CFB.read(buf, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    // read original second paragraph
    const origDoc = await loadHwp(fixture)
    const origSecondText = origDoc.sections[0].paragraphs[1]?.runs.map((r) => r.text).join('')

    mutateHwpCfb(cfb, [{ type: 'setText', ref: 's0.p0', text: 'CHANGED' }], compressed)

    const outPath = tmpPath('mutator-preserve')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const doc = await loadHwp(outPath)
      const secondText = doc.sections[0].paragraphs[1]?.runs.map((r) => r.text).join('')
      expect(secondText).toBe(origSecondText)
    } finally {
      await unlink(outPath)
    }
  })

  it('resets PARA_CHAR_SHAPE to single entry after setText', async () => {
    const buf = await readFile(fixture)
    const cfb = CFB.read(buf, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'setText', ref: 's0.p0', text: 'REPLACED' }], compressed)

    let sectionStream = getEntryBuffer(cfb, '/BodyText/Section0')
    if (compressed) {
      const { decompressStream } = await import('./stream-util')
      sectionStream = decompressStream(sectionStream)
    }

    let paragraphIndex = -1
    let charShapeData: Buffer | null = null
    for (const { header, data } of iterateRecords(sectionStream)) {
      if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
        paragraphIndex += 1
        charShapeData = null
        continue
      }
      if (paragraphIndex === 0 && header.tagId === TAG.PARA_CHAR_SHAPE) {
        charShapeData = data
        break
      }
    }

    expect(charShapeData).not.toBeNull()
    expect(charShapeData!.length).toBe(8)
    expect(charShapeData!.readUInt32LE(0)).toBe(0)
  })

  it('setFormat updates all PARA_CHAR_SHAPE entries', async () => {
    const buf = await readFile(fixture)
    const cfb = CFB.read(buf, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'setFormat', ref: 's0.p0', format: { bold: true } }], compressed)

    let sectionStream = getEntryBuffer(cfb, '/BodyText/Section0')
    if (compressed) {
      const { decompressStream } = await import('./stream-util')
      sectionStream = decompressStream(sectionStream)
    }

    let paragraphIndex = -1
    let charShapeData: Buffer | null = null
    for (const { header, data } of iterateRecords(sectionStream)) {
      if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
        paragraphIndex += 1
        charShapeData = null
        continue
      }
      if (paragraphIndex === 0 && header.tagId === TAG.PARA_CHAR_SHAPE) {
        charShapeData = data
        break
      }
    }

    expect(charShapeData).not.toBeNull()
    const entryCount = Math.floor(charShapeData!.length / 8)
    expect(entryCount).toBeGreaterThan(0)
    const firstRef = charShapeData!.readUInt32LE(4)
    for (let i = 1; i < entryCount; i++) {
      expect(charShapeData!.readUInt32LE(i * 8 + 4)).toBe(firstRef)
    }
  })

  it('applies inline setFormat to [0, 5) only and preserves text', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['Hello World'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'setFormat', ref: 's0.p0', format: { bold: true }, start: 0, end: 5 }], compressed)

    const charShapeData = await getParagraphCharShapeData(cfb, compressed, 0)
    expect(charShapeData).not.toBeNull()
    expect(charShapeData!.length).toBe(16)
    expect(charShapeData!.readUInt32LE(0)).toBe(0)
    expect(charShapeData!.readUInt32LE(8)).toBe(5)

    const outPath = tmpPath('mutator-setFormat-inline-head')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const doc = await loadHwp(outPath)
      const text = doc.sections[0].paragraphs[0].runs.map((r) => r.text).join('')
      expect(text).toBe('Hello World')
    } finally {
      await unlink(outPath)
    }
  })

  it('keeps full-paragraph setFormat behavior when start/end are omitted', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['Hello World'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'setFormat', ref: 's0.p0', format: { italic: true } }], compressed)

    const charShapeData = await getParagraphCharShapeData(cfb, compressed, 0)
    expect(charShapeData).not.toBeNull()
    expect(charShapeData!.length).toBe(6)

    const outPath = tmpPath('mutator-setFormat-whole')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const doc = await loadHwp(outPath)
      const text = doc.sections[0].paragraphs[0].runs.map((r) => r.text).join('')
      expect(text).toBe('Hello World')
    } finally {
      await unlink(outPath)
    }
  })

  it('throws when inline setFormat range exceeds text length', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['Hello World'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    expect(() => {
      mutateHwpCfb(
        cfb,
        [{ type: 'setFormat', ref: 's0.p0', format: { underline: true }, start: 0, end: 99 }],
        compressed,
      )
    }).toThrow('Offset out of range')
  })

  it('applies inline setFormat to middle range and creates three entries', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['Hello World!'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(
      cfb,
      [{ type: 'setFormat', ref: 's0.p0', format: { color: '#ff0000' }, start: 6, end: 11 }],
      compressed,
    )

    const charShapeData = await getParagraphCharShapeData(cfb, compressed, 0)
    expect(charShapeData).not.toBeNull()
    expect(charShapeData!.length).toBe(24)
    expect(charShapeData!.readUInt32LE(0)).toBe(0)
    expect(charShapeData!.readUInt32LE(8)).toBe(6)
    expect(charShapeData!.readUInt32LE(16)).toBe(11)

    const outPath = tmpPath('mutator-setFormat-inline-middle')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const doc = await loadHwp(outPath)
      const text = doc.sections[0].paragraphs[0].runs.map((r) => r.text).join('')
      expect(text).toBe('Hello World!')
    } finally {
      await unlink(outPath)
    }
  })
})

describe('mutateHwpCfb addTable', () => {
  it('adds table and re-reads correctly', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['Hello'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(
      cfb,
      [
        {
          type: 'addTable',
          ref: 's0',
          rows: 2,
          cols: 2,
          position: 'end',
          data: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
      ],
      compressed,
    )

    const outPath = tmpPath('mutator-addTable')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const doc = await loadHwp(outPath)
      expect(doc.sections[0].tables).toHaveLength(1)
      expect(doc.sections[0].tables[0].rows).toHaveLength(2)
      expect(doc.sections[0].tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('A')
      expect(doc.sections[0].tables[0].rows[0].cells[1].paragraphs[0].runs[0].text).toBe('B')
      expect(doc.sections[0].tables[0].rows[1].cells[0].paragraphs[0].runs[0].text).toBe('C')
      expect(doc.sections[0].tables[0].rows[1].cells[1].paragraphs[0].runs[0].text).toBe('D')
    } finally {
      await unlink(outPath)
    }
  })

  it('adds table with empty cells', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['Hello'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'addTable', ref: 's0', rows: 1, cols: 3, position: 'end' }], compressed)

    const outPath = tmpPath('mutator-addTable-empty')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const doc = await loadHwp(outPath)
      expect(doc.sections[0].tables).toHaveLength(1)
      expect(doc.sections[0].tables[0].rows).toHaveLength(1)
      expect(doc.sections[0].tables[0].rows[0].cells).toHaveLength(3)
      const cellText = doc.sections[0].tables[0].rows[0].cells[0].paragraphs[0].runs.map((r) => r.text).join('')
      expect(cellText).toBe('')
    } finally {
      await unlink(outPath)
    }
  })

  it('preserves existing content when adding table', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['Hello'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'addTable', ref: 's0', rows: 1, cols: 1, position: 'end', data: [['Cell']] }], compressed)

    const outPath = tmpPath('mutator-addTable-preserve')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const doc = await loadHwp(outPath)
      const firstParaText = doc.sections[0].paragraphs[0].runs.map((r) => r.text).join('')
      expect(firstParaText).toBe('Hello')
      expect(doc.sections[0].tables).toHaveLength(1)
    } finally {
      await unlink(outPath)
    }
  })

  it('addTable with position=end appends to document', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['END_ANCHOR'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'addTable', ref: 's0', rows: 1, cols: 2, position: 'end' }], compressed)

    const outPath = tmpPath('mutator-addTable-position-end-out')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
    const hwpxPath = join(tmpdir(), `mutator-addTable-position-end-${Date.now()}-${Math.random().toString(36).slice(2)}.hwpx`)

    try {
      const doc = await loadHwp(outPath)
      expect(doc.sections[0].tables).toHaveLength(1)

      await convertCommand(outPath, hwpxPath, { force: true })
      const zip = await JSZip.loadAsync(await readFile(hwpxPath))
      const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
      const paragraphIndex = sectionXml.indexOf('END_ANCHOR')
      const tableIndex = sectionXml.lastIndexOf('<hp:tbl>')
      expect(tableIndex).toBeGreaterThan(paragraphIndex)
    } finally {
      await unlink(outPath)
      await unlink(hwpxPath).catch(() => {})
    }
  })

  it('addTable with position=before inserts before paragraph 0', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['FIRST_PARAGRAPH'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'addTable', ref: 's0.p0', rows: 1, cols: 1, position: 'before' }], compressed)

    const outPath = tmpPath('mutator-addTable-position-before-out')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
    const hwpxPath = join(tmpdir(), `mutator-addTable-position-before-${Date.now()}-${Math.random().toString(36).slice(2)}.hwpx`)

    try {
      const doc = await loadHwp(outPath)
      expect(doc.sections[0].tables).toHaveLength(1)
      expect(doc.sections[0].paragraphs.map((p) => p.runs.map((r) => r.text).join(''))).toEqual(['', 'FIRST_PARAGRAPH'])

      await convertCommand(outPath, hwpxPath, { force: true })
      const zip = await JSZip.loadAsync(await readFile(hwpxPath))
      const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
      expect(sectionXml).toContain('<hp:tbl>')
      expect(sectionXml).toContain('FIRST_PARAGRAPH')
    } finally {
      await unlink(outPath)
      await unlink(hwpxPath).catch(() => {})
    }
  })

  it('addTable with position=after inserts after paragraph 0', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['PARA_A', 'PARA_B'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'addTable', ref: 's0.p0', rows: 1, cols: 1, position: 'after' }], compressed)

    const outPath = tmpPath('mutator-addTable-position-after-out')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
    const hwpxPath = join(tmpdir(), `mutator-addTable-position-after-${Date.now()}-${Math.random().toString(36).slice(2)}.hwpx`)

    try {
      const doc = await loadHwp(outPath)
      expect(doc.sections[0].tables).toHaveLength(1)
      expect(doc.sections[0].paragraphs.map((p) => p.runs.map((r) => r.text).join(''))).toEqual(['PARA_A', '', 'PARA_B'])

      await convertCommand(outPath, hwpxPath, { force: true })
      const zip = await JSZip.loadAsync(await readFile(hwpxPath))
      const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
      const firstParagraphIndex = sectionXml.indexOf('PARA_A')
      const secondParagraphIndex = sectionXml.indexOf('PARA_B')
      expect(firstParagraphIndex).toBeGreaterThan(-1)
      expect(secondParagraphIndex).toBeGreaterThan(firstParagraphIndex)
      expect(sectionXml).toContain('<hp:tbl>')
    } finally {
      await unlink(outPath)
      await unlink(hwpxPath).catch(() => {})
    }
  })
})

describe('mutateHwpCfb addParagraph', () => {
  const readParagraphTexts = async (path: string): Promise<string[]> => {
    const doc = await loadHwp(path)
    return doc.sections[0].paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
  }

  it('appends a paragraph at section end', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['First', 'Second'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'addParagraph', ref: 's0', text: 'Third', position: 'end' }], compressed)

    const outPath = tmpPath('mutator-addParagraph-end')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const paragraphTexts = await readParagraphTexts(outPath)
      expect(paragraphTexts).toEqual(['First', 'Second', 'Third'])
    } finally {
      await unlink(outPath)
    }
  })

  it('inserts a paragraph before target paragraph', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['First', 'Second'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'addParagraph', ref: 's0.p1', text: 'Inserted', position: 'before' }], compressed)

    const outPath = tmpPath('mutator-addParagraph-before')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const paragraphTexts = await readParagraphTexts(outPath)
      expect(paragraphTexts).toEqual(['First', 'Inserted', 'Second'])
    } finally {
      await unlink(outPath)
    }
  })

  it('inserts a paragraph after target paragraph', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['First', 'Second'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'addParagraph', ref: 's0.p0', text: 'Inserted', position: 'after' }], compressed)

    const outPath = tmpPath('mutator-addParagraph-after')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const paragraphTexts = await readParagraphTexts(outPath)
      expect(paragraphTexts).toEqual(['First', 'Inserted', 'Second'])
    } finally {
      await unlink(outPath)
    }
  })

  it('keeps existing paragraph text unchanged when inserting', async () => {
    const fixture = await createTestHwpBinary({ paragraphs: ['First', 'Second'] })
    const cfb = CFB.read(fixture, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'addParagraph', ref: 's0.p0', text: 'Middle', position: 'after' }], compressed)

    const outPath = tmpPath('mutator-addParagraph-preserve')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const paragraphTexts = await readParagraphTexts(outPath)
      expect(paragraphTexts[0]).toBe('First')
      expect(paragraphTexts[2]).toBe('Second')
    } finally {
      await unlink(outPath)
    }
  })

  it('appends paragraph after table add in separate mutateHwpCfb calls', async () => {
    const hwpPath = tmpPath('mutator-addTable-then-addParagraph-separate')
    await writeFile(hwpPath, await createHwp())

    try {
      const firstBuffer = await readFile(hwpPath)
      const firstCfb = CFB.read(firstBuffer, { type: 'buffer' })
      const firstCompressed = getCompressionFlag(getEntryBuffer(firstCfb, '/FileHeader'))

      mutateHwpCfb(firstCfb, [{ type: 'addTable', ref: 's0', rows: 2, cols: 2, position: 'end' }], firstCompressed)
      await writeFile(hwpPath, Buffer.from(CFB.write(firstCfb, { type: 'buffer' })))

      const secondBuffer = await readFile(hwpPath)
      const secondCfb = CFB.read(secondBuffer, { type: 'buffer' })
      const secondCompressed = getCompressionFlag(getEntryBuffer(secondCfb, '/FileHeader'))

      mutateHwpCfb(
        secondCfb,
        [{ type: 'addParagraph', ref: 's0', text: 'After table', position: 'end' }],
        secondCompressed,
      )
      await writeFile(hwpPath, Buffer.from(CFB.write(secondCfb, { type: 'buffer' })))

      const doc = await loadHwp(hwpPath)
      const paragraphTexts = doc.sections[0].paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(''),
      )
      expect(doc.sections[0].tables).toHaveLength(1)
      expect(paragraphTexts).toContain('After table')
    } finally {
      await unlink(hwpPath)
    }
  })

  it('appends paragraph after table add in single mutateHwpCfb call', async () => {
    const hwpPath = tmpPath('mutator-addTable-then-addParagraph-single')
    await writeFile(hwpPath, await createHwp())

    try {
      const buffer = await readFile(hwpPath)
      const cfb = CFB.read(buffer, { type: 'buffer' })
      const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

      mutateHwpCfb(
        cfb,
        [
          { type: 'addTable', ref: 's0', rows: 2, cols: 2, position: 'end' },
          { type: 'addParagraph', ref: 's0', text: 'After table', position: 'end' },
        ],
        compressed,
      )
      await writeFile(hwpPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

      const doc = await loadHwp(hwpPath)
      const paragraphTexts = doc.sections[0].paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(''),
      )
      expect(doc.sections[0].tables).toHaveLength(1)
      expect(paragraphTexts).toContain('After table')
    } finally {
      await unlink(hwpPath)
    }
  })

  it('appends formatted paragraph after table add in separate calls', async () => {
    const hwpPath = tmpPath('mutator-addTable-then-addParagraph-formatted')
    await writeFile(hwpPath, await createHwp())

    try {
      const firstBuffer = await readFile(hwpPath)
      const firstCfb = CFB.read(firstBuffer, { type: 'buffer' })
      const firstCompressed = getCompressionFlag(getEntryBuffer(firstCfb, '/FileHeader'))

      mutateHwpCfb(firstCfb, [{ type: 'addTable', ref: 's0', rows: 1, cols: 1, position: 'end' }], firstCompressed)
      await writeFile(hwpPath, Buffer.from(CFB.write(firstCfb, { type: 'buffer' })))

      const secondBuffer = await readFile(hwpPath)
      const secondCfb = CFB.read(secondBuffer, { type: 'buffer' })
      const secondCompressed = getCompressionFlag(getEntryBuffer(secondCfb, '/FileHeader'))

      mutateHwpCfb(
        secondCfb,
        [{ type: 'addParagraph', ref: 's0', text: 'Formatted after table', position: 'end', format: { bold: true } }],
        secondCompressed,
      )
      await writeFile(hwpPath, Buffer.from(CFB.write(secondCfb, { type: 'buffer' })))

      const paragraphTexts = await readParagraphTexts(hwpPath)
      expect(paragraphTexts).toContain('Formatted after table')
    } finally {
      await unlink(hwpPath)
    }
  })

  it('appends plain paragraph on freshly created HWP', async () => {
    const hwpPath = tmpPath('mutator-addParagraph-fresh-plain')
    await writeFile(hwpPath, await createHwp())

    try {
      const buffer = await readFile(hwpPath)
      const cfb = CFB.read(buffer, { type: 'buffer' })
      const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

      mutateHwpCfb(cfb, [{ type: 'addParagraph', ref: 's0', text: 'hello', position: 'end' }], compressed)

      await writeFile(hwpPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
      const paragraphTexts = await readParagraphTexts(hwpPath)
      expect(paragraphTexts).toEqual(['', 'hello'])
    } finally {
      await unlink(hwpPath)
    }
  })

  it('appends formatted paragraph on freshly created HWP', async () => {
    const hwpPath = tmpPath('mutator-addParagraph-fresh-formatted')
    await writeFile(hwpPath, await createHwp())

    try {
      const buffer = await readFile(hwpPath)
      const cfb = CFB.read(buffer, { type: 'buffer' })
      const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

      mutateHwpCfb(
        cfb,
        [{ type: 'addParagraph', ref: 's0', text: 'hello', position: 'end', format: { bold: true } }],
        compressed,
      )

      await writeFile(hwpPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
      const paragraphTexts = await readParagraphTexts(hwpPath)
      expect(paragraphTexts).toEqual(['', 'hello'])
    } finally {
      await unlink(hwpPath)
    }
  })
})

async function getParagraphHeaderData(
  cfb: CFB.CFB$Container,
  compressed: boolean,
  paragraphTarget: number,
): Promise<Buffer | null> {
  let sectionStream = getEntryBuffer(cfb, '/BodyText/Section0')
  if (compressed) {
    const { decompressStream } = await import('./stream-util')
    sectionStream = decompressStream(sectionStream)
  }

  let paragraphIndex = -1
  for (const { header, data } of iterateRecords(sectionStream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      paragraphIndex += 1
      if (paragraphIndex === paragraphTarget) {
        return data
      }
    }
  }

  return null
}

describe('mutateHwpCfb addParagraph heading/style', () => {
  const readParagraphTexts = async (path: string): Promise<string[]> => {
    const doc = await loadHwp(path)
    return doc.sections[0].paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
  }

  it('sets paraShapeRef and styleRef when heading is specified', async () => {
    const hwpPath = tmpPath('mutator-addParagraph-heading')
    await writeFile(hwpPath, await createHwp())

    try {
      const buffer = await readFile(hwpPath)
      const cfb = CFB.read(buffer, { type: 'buffer' })
      const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

      mutateHwpCfb(
        cfb,
        [{ type: 'addParagraph', ref: 's0', text: 'Heading 1', position: 'end', heading: 1 }],
        compressed,
      )

      // Paragraph 0 is the empty initial paragraph, paragraph 1 is the new one
      const headerData = await getParagraphHeaderData(cfb, compressed, 1)
      expect(headerData).not.toBeNull()
      // byte 8: paraShapeRef (uint16) = 1 (개요 1 paraShape)
      expect(headerData!.readUInt16LE(8)).toBe(1)
      // byte 10: styleRef (uint8) = 1 (개요 1 style index)
      expect(headerData!.readUInt8(10)).toBe(1)

      await writeFile(hwpPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
      const texts = await readParagraphTexts(hwpPath)
      expect(texts).toContain('Heading 1')
    } finally {
      await unlink(hwpPath)
    }
  })

  it('sets paraShapeRef and styleRef for heading level 3', async () => {
    const hwpPath = tmpPath('mutator-addParagraph-heading3')
    await writeFile(hwpPath, await createHwp())

    try {
      const buffer = await readFile(hwpPath)
      const cfb = CFB.read(buffer, { type: 'buffer' })
      const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

      mutateHwpCfb(
        cfb,
        [{ type: 'addParagraph', ref: 's0', text: 'Heading 3', position: 'end', heading: 3 }],
        compressed,
      )

      const headerData = await getParagraphHeaderData(cfb, compressed, 1)
      expect(headerData).not.toBeNull()
      expect(headerData!.readUInt16LE(8)).toBe(3)
      expect(headerData!.readUInt8(10)).toBe(3)
    } finally {
      await unlink(hwpPath)
    }
  })

  it('looks up style by name', async () => {
    const hwpPath = tmpPath('mutator-addParagraph-style-name')
    await writeFile(hwpPath, await createHwp())

    try {
      const buffer = await readFile(hwpPath)
      const cfb = CFB.read(buffer, { type: 'buffer' })
      const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

      mutateHwpCfb(
        cfb,
        [{ type: 'addParagraph', ref: 's0', text: 'Styled', position: 'end', style: '개요 2' }],
        compressed,
      )

      const headerData = await getParagraphHeaderData(cfb, compressed, 1)
      expect(headerData).not.toBeNull()
      // 개요 2 is style index 2, paraShapeRef=2
      expect(headerData!.readUInt16LE(8)).toBe(2)
      expect(headerData!.readUInt8(10)).toBe(2)
    } finally {
      await unlink(hwpPath)
    }
  })

  it('looks up style by numeric ID', async () => {
    const hwpPath = tmpPath('mutator-addParagraph-style-id')
    await writeFile(hwpPath, await createHwp())

    try {
      const buffer = await readFile(hwpPath)
      const cfb = CFB.read(buffer, { type: 'buffer' })
      const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

      mutateHwpCfb(cfb, [{ type: 'addParagraph', ref: 's0', text: 'Styled', position: 'end', style: 4 }], compressed)

      const headerData = await getParagraphHeaderData(cfb, compressed, 1)
      expect(headerData).not.toBeNull()
      // Style index 4 = 개요 4, paraShapeRef=4
      expect(headerData!.readUInt16LE(8)).toBe(4)
      expect(headerData!.readUInt8(10)).toBe(4)
    } finally {
      await unlink(hwpPath)
    }
  })

  it('throws when both heading and style are specified', async () => {
    const hwpPath = tmpPath('mutator-addParagraph-heading-style-conflict')
    await writeFile(hwpPath, await createHwp())

    try {
      const buffer = await readFile(hwpPath)
      const cfb = CFB.read(buffer, { type: 'buffer' })
      const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

      expect(() => {
        mutateHwpCfb(
          cfb,
          [{ type: 'addParagraph', ref: 's0', text: 'Bad', position: 'end', heading: 1, style: '개요 1' }],
          compressed,
        )
      }).toThrow('Cannot specify both heading and style')
    } finally {
      await unlink(hwpPath)
    }
  })

  it('throws when heading style not found in document', async () => {
    // createTestHwpBinary only has 'Normal' style, no heading styles
    const buf = await createTestHwpBinary({ paragraphs: ['Hello'] })
    const cfb = CFB.read(buf, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    expect(() => {
      mutateHwpCfb(cfb, [{ type: 'addParagraph', ref: 's0', text: 'Bad', position: 'end', heading: 1 }], compressed)
    }).toThrow('개요 1')
  })

  it('defaults to paraShapeRef=0 and styleRef=0 without heading/style', async () => {
    const hwpPath = tmpPath('mutator-addParagraph-default-refs')
    await writeFile(hwpPath, await createHwp())

    try {
      const buffer = await readFile(hwpPath)
      const cfb = CFB.read(buffer, { type: 'buffer' })
      const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

      mutateHwpCfb(cfb, [{ type: 'addParagraph', ref: 's0', text: 'Plain', position: 'end' }], compressed)

      const headerData = await getParagraphHeaderData(cfb, compressed, 1)
      expect(headerData).not.toBeNull()
      expect(headerData!.readUInt16LE(8)).toBe(0)
      expect(headerData!.readUInt8(10)).toBe(0)
    } finally {
      await unlink(hwpPath)
    }
  })
})
