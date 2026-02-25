import { describe, expect, it } from 'bun:test'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestHwpx } from '../../test-helpers'
import { loadHwpx } from './loader'
import { mutateHwpxZip } from './mutator'
import { parseSections } from './section-parser'

const tmpPath = (name: string) => join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.hwpx`)

describe('mutateHwpxZip', () => {
  it('applies setText to a paragraph in-memory', async () => {
    const filePath = tmpPath('mutator-setText')
    const fixture = await createTestHwpx({ paragraphs: ['Original', 'Keep'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [{ type: 'setText', ref: 's0.p0', text: 'MUTATED' }])

      // verify via XML directly from the in-memory zip
      const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
      expect(sectionXml).toContain('MUTATED')
      expect(sectionXml).toContain('Keep')
    } finally {
      await unlink(filePath)
    }
  })

  it('applies setTableCell in-memory', async () => {
    const filePath = tmpPath('mutator-setTableCell')
    const fixture = await createTestHwpx({
      tables: [{ rows: [['CellA', 'CellB']] }],
    })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [{ type: 'setTableCell', ref: 's0.t0.r0.c0', text: 'MUTATED_CELL' }])

      const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
      expect(sectionXml).toContain('MUTATED_CELL')
      expect(sectionXml).toContain('CellB')
    } finally {
      await unlink(filePath)
    }
  })

  it('no-ops on empty operations', async () => {
    const filePath = tmpPath('mutator-noop')
    const fixture = await createTestHwpx({ paragraphs: ['Hello'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()
      const xmlBefore = await zip.file('Contents/section0.xml')!.async('string')

      await mutateHwpxZip(zip, archive, [])

      const xmlAfter = await zip.file('Contents/section0.xml')!.async('string')
      expect(xmlAfter).toBe(xmlBefore)
    } finally {
      await unlink(filePath)
    }
  })

  it('mutated zip can be written and re-read correctly', async () => {
    const filePath = tmpPath('mutator-roundtrip')
    const fixture = await createTestHwpx({ paragraphs: ['Before'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [{ type: 'setText', ref: 's0.p0', text: 'After' }])

      // write the mutated zip to a new file
      const outPath = tmpPath('mutator-roundtrip-out')
      const buffer = await zip.generateAsync({ type: 'nodebuffer' })
      await writeFile(outPath, buffer)

      // re-read independently
      const archive2 = await loadHwpx(outPath)
      const sections = await parseSections(archive2)
      expect(sections[0].paragraphs[0].runs.map((r) => r.text).join('')).toBe('After')

      await unlink(outPath)
    } finally {
      await unlink(filePath)
    }
  })

  it('applies addTable in-memory', async () => {
    const filePath = tmpPath('mutator-addTable')
    const fixture = await createTestHwpx({ paragraphs: ['Hello'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [
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
      ])

      const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
      expect(sectionXml).toContain('hp:tbl')
      expect(sectionXml).toContain('A')
      expect(sectionXml).toContain('D')
      expect(sectionXml).toContain('Hello')
    } finally {
      await unlink(filePath)
    }
  })

  it('addTable roundtrip — re-read via parseSections', async () => {
    const filePath = tmpPath('mutator-addTable-roundtrip')
    const fixture = await createTestHwpx({ paragraphs: ['Intro'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [
        {
          type: 'addTable',
          ref: 's0',
          rows: 2,
          cols: 3,
          data: [
            ['a', 'b', 'c'],
            ['d', 'e', 'f'],
          ],
        },
      ])

      const outPath = tmpPath('mutator-addTable-roundtrip-out')
      const buffer = await zip.generateAsync({ type: 'nodebuffer' })
      await writeFile(outPath, buffer)

      const archive2 = await loadHwpx(outPath)
      const sections = await parseSections(archive2)
      expect(sections[0].tables).toHaveLength(1)
      expect(sections[0].tables[0].rows).toHaveLength(2)
      expect(sections[0].tables[0].rows[0].cells).toHaveLength(3)
      expect(sections[0].tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('a')
      expect(sections[0].tables[0].rows[1].cells[2].paragraphs[0].runs[0].text).toBe('f')

      await unlink(outPath)
    } finally {
      await unlink(filePath)
    }
  })

  it('addTable with empty data creates empty cells', async () => {
    const filePath = tmpPath('mutator-addTable-empty')
    const fixture = await createTestHwpx({ paragraphs: ['Intro'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [{ type: 'addTable', ref: 's0', rows: 1, cols: 2 }])

      const outPath = tmpPath('mutator-addTable-empty-out')
      const buffer = await zip.generateAsync({ type: 'nodebuffer' })
      await writeFile(outPath, buffer)

      const archive2 = await loadHwpx(outPath)
      const sections = await parseSections(archive2)
      expect(sections[0].tables).toHaveLength(1)
      expect(sections[0].tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('')

      await unlink(outPath)
    } finally {
      await unlink(filePath)
    }
  })
})
