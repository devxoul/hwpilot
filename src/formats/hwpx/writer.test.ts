import { describe, expect, it } from 'bun:test'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestHwpx } from '../../test-helpers'
import { parseHeader } from './header-parser'
import { loadHwpx } from './loader'
import { parseSections } from './section-parser'
import { editHwpx } from './writer'

const tmpPath = (name: string) => join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.hwpx`)

describe('editHwpx', () => {
  it('setText edits target paragraph and preserves others', async () => {
    const filePath = tmpPath('writer-set-text')
    const fixture = await createTestHwpx({ paragraphs: ['Hello', 'World'] })
    await Bun.write(filePath, fixture)

    try {
      await editHwpx(filePath, [{ type: 'setText', ref: 's0.p0', text: 'Modified' }])

      const archive = await loadHwpx(filePath)
      const sections = await parseSections(archive)

      expect(sections[0].paragraphs[0].runs.map((run) => run.text).join('')).toBe('Modified')
      expect(sections[0].paragraphs[1].runs.map((run) => run.text).join('')).toBe('World')
    } finally {
      await unlink(filePath)
    }
  })

  it('setTableCell edits target cell and preserves other cells', async () => {
    const filePath = tmpPath('writer-table-cell')
    const fixture = await createTestHwpx({
      tables: [{ rows: [['A', 'B']] }],
    })
    await Bun.write(filePath, fixture)

    try {
      await editHwpx(filePath, [{ type: 'setTableCell', ref: 's0.t0.r0.c0', text: 'Changed' }])

      const archive = await loadHwpx(filePath)
      const sections = await parseSections(archive)

      expect(sections[0].tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('Changed')
      expect(sections[0].tables[0].rows[0].cells[1].paragraphs[0].runs[0].text).toBe('B')
    } finally {
      await unlink(filePath)
    }
  })

  it('setText edits target text box paragraph and preserves section paragraph', async () => {
    const filePath = tmpPath('writer-textbox-text')
    const fixture = await createTestHwpx({
      paragraphs: ['Section text'],
      textBoxes: [{ text: 'Text box original' }],
    })
    await Bun.write(filePath, fixture)

    try {
      await editHwpx(filePath, [{ type: 'setText', ref: 's0.tb0.p0', text: 'Text box changed' }])

      const archive = await loadHwpx(filePath)
      const sections = await parseSections(archive)

      expect(sections[0].textBoxes[0]?.paragraphs[0]?.runs[0]?.text).toBe('Text box changed')
      expect(sections[0].paragraphs[0]?.runs[0]?.text).toBe('Section text')
    } finally {
      await unlink(filePath)
    }
  })

  it('setText targets the requested text box only', async () => {
    const filePath = tmpPath('writer-textbox-target')
    const fixture = await createTestHwpx({
      textBoxes: [{ text: 'First box' }, { text: 'Second box' }],
    })
    await Bun.write(filePath, fixture)

    try {
      await editHwpx(filePath, [{ type: 'setText', ref: 's0.tb1.p0', text: 'Updated second box' }])

      const archive = await loadHwpx(filePath)
      const sections = await parseSections(archive)

      expect(sections[0].textBoxes[0]?.paragraphs[0]?.runs[0]?.text).toBe('First box')
      expect(sections[0].textBoxes[1]?.paragraphs[0]?.runs[0]?.text).toBe('Updated second box')
    } finally {
      await unlink(filePath)
    }
  })

  it('preserves untouched ZIP entries byte-identical', async () => {
    const filePath = tmpPath('writer-roundtrip')
    const fixture = await createTestHwpx({ paragraphs: ['Original'] })
    await Bun.write(filePath, fixture)

    try {
      const beforeArchive = await loadHwpx(filePath)
      const beforeVersion = await beforeArchive.getZip().file('version.xml')?.async('nodebuffer')

      await editHwpx(filePath, [{ type: 'setText', ref: 's0.p0', text: 'Modified' }])

      const afterArchive = await loadHwpx(filePath)
      const afterVersion = await afterArchive.getZip().file('version.xml')?.async('nodebuffer')

      expect(beforeVersion).toBeDefined()
      expect(afterVersion).toBeDefined()
      expect(Buffer.compare(beforeVersion as Buffer, afterVersion as Buffer)).toBe(0)
    } finally {
      await unlink(filePath)
    }
  })

  it('applies multiple operations in one call', async () => {
    const filePath = tmpPath('writer-multi-op')
    const fixture = await createTestHwpx({ paragraphs: ['A', 'B'] })
    await Bun.write(filePath, fixture)

    try {
      await editHwpx(filePath, [
        { type: 'setText', ref: 's0.p0', text: 'First' },
        { type: 'setText', ref: 's0.p1', text: 'Second' },
      ])

      const archive = await loadHwpx(filePath)
      const sections = await parseSections(archive)

      expect(sections[0].paragraphs[0].runs[0].text).toBe('First')
      expect(sections[0].paragraphs[1].runs[0].text).toBe('Second')
    } finally {
      await unlink(filePath)
    }
  })

  it('setFormat creates bold charPr and updates run reference', async () => {
    const filePath = tmpPath('writer-format')
    const fixture = await createTestHwpx({ paragraphs: ['Hello'] })
    await Bun.write(filePath, fixture)

    try {
      await editHwpx(filePath, [
        {
          type: 'setFormat',
          ref: 's0.p0',
          format: { bold: true },
        },
      ])

      const archive = await loadHwpx(filePath)
      const header = parseHeader(await archive.getHeaderXml())
      const sections = await parseSections(archive)

      const runCharShapeRef = sections[0].paragraphs[0].runs[0].charShapeRef
      const runCharShape = header.charShapes.find((shape) => shape.id === runCharShapeRef)

      expect(header.charShapes.length).toBeGreaterThan(1)
      expect(runCharShape).toBeDefined()
      expect(runCharShape?.bold).toBe(true)
    } finally {
      await unlink(filePath)
    }
  })
})
