import { describe, expect, it } from 'bun:test'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import CFB from 'cfb'
import { createTestHwpBinary } from '../../test-helpers'
import { getEntryBuffer, mutateHwpCfb } from './mutator'
import { loadHwp } from './reader'
import { iterateRecords } from './record-parser'
import { getCompressionFlag } from './stream-util'
import { TAG } from './tag-ids'

const fixture = 'e2e/fixtures/임금 등 청구의 소.hwp'
const tmpPath = (name: string) => join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.hwp`)

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
    expect(charShapeData!.readUInt32LE(0)).toBe(1)
    expect(charShapeData!.readUInt32LE(4)).toBe(0)
    expect(charShapeData!.length).toBe(12)
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
    const count = charShapeData!.readUInt32LE(0)
    const firstId = charShapeData!.readUInt32LE(8)
    for (let i = 1; i < count; i++) {
      const idOffset = 4 + i * 8 + 4
      expect(charShapeData!.readUInt32LE(idOffset)).toBe(firstId)
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

    mutateHwpCfb(cfb, [{ type: 'addTable', ref: 's0', rows: 1, cols: 3 }], compressed)

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

    mutateHwpCfb(cfb, [{ type: 'addTable', ref: 's0', rows: 1, cols: 1, data: [['Cell']] }], compressed)

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
})
