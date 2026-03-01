import { describe, expect, it } from 'bun:test'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import type { XmlNode } from '@/shared/edit-types'
import { createTestHwpx } from '../../test-helpers'
import { loadHwpx } from './loader'
import { buildXml, escapeXml, mutateHwpxZip, parseXml } from './mutator'
import { parseSections } from './section-parser'

const tmpPath = (name: string) => join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.hwpx`)

function rewriteParagraphRuns(sectionXml: string, runTexts: string[]): string {
  const runMarkup = runTexts.map((text) => `<hp:run hp:charPrIDRef="0"><hp:t>${text}</hp:t></hp:run>`).join('')

  return sectionXml.replace(/<hp:run hp:charPrIDRef="0"><hp:t>[\s\S]*?<\/hp:t><\/hp:run>/, runMarkup)
}

async function setFirstParagraphRuns(filePath: string, runTexts: string[]): Promise<void> {
  const archive = await loadHwpx(filePath)
  const zip = archive.getZip()
  const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
  zip.file('Contents/section0.xml', rewriteParagraphRuns(sectionXml, runTexts))
  await Bun.write(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

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

  it('addParagraph appends to end', async () => {
    const filePath = tmpPath('mutator-addParagraph-end')
    const fixture = await createTestHwpx({ paragraphs: ['First', 'Second'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [{ type: 'addParagraph', ref: 's0', text: 'Third', position: 'end' }])

      const outPath = tmpPath('mutator-addParagraph-end-out')
      const buffer = await zip.generateAsync({ type: 'nodebuffer' })
      await writeFile(outPath, buffer)

      const archive2 = await loadHwpx(outPath)
      const sections = await parseSections(archive2)
      expect(sections[0].paragraphs).toHaveLength(3)
      expect(sections[0].paragraphs[2].runs.map((r) => r.text).join('')).toBe('Third')

      await unlink(outPath)
    } finally {
      await unlink(filePath)
    }
  })

  it('addParagraph inserts before target paragraph', async () => {
    const filePath = tmpPath('mutator-addParagraph-before')
    const fixture = await createTestHwpx({ paragraphs: ['First', 'Second'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [{ type: 'addParagraph', ref: 's0.p1', text: 'Inserted', position: 'before' }])

      const outPath = tmpPath('mutator-addParagraph-before-out')
      const buffer = await zip.generateAsync({ type: 'nodebuffer' })
      await writeFile(outPath, buffer)

      const archive2 = await loadHwpx(outPath)
      const sections = await parseSections(archive2)
      const texts = sections[0].paragraphs.map((p) => p.runs.map((r) => r.text).join(''))
      expect(texts).toEqual(['First', 'Inserted', 'Second'])

      await unlink(outPath)
    } finally {
      await unlink(filePath)
    }
  })

  it('addParagraph inserts after target paragraph', async () => {
    const filePath = tmpPath('mutator-addParagraph-after')
    const fixture = await createTestHwpx({ paragraphs: ['First', 'Second'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [{ type: 'addParagraph', ref: 's0.p0', text: 'Inserted', position: 'after' }])

      const outPath = tmpPath('mutator-addParagraph-after-out')
      const buffer = await zip.generateAsync({ type: 'nodebuffer' })
      await writeFile(outPath, buffer)

      const archive2 = await loadHwpx(outPath)
      const sections = await parseSections(archive2)
      const texts = sections[0].paragraphs.map((p) => p.runs.map((r) => r.text).join(''))
      expect(texts).toEqual(['First', 'Inserted', 'Second'])

      await unlink(outPath)
    } finally {
      await unlink(filePath)
    }
  })

  it('addParagraph applies format by assigning non-default charPrIDRef', async () => {
    const filePath = tmpPath('mutator-addParagraph-format')
    const fixture = await createTestHwpx({ paragraphs: ['First', 'Second'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [
        {
          type: 'addParagraph',
          ref: 's0',
          text: 'Bold Paragraph',
          position: 'end',
          format: { bold: true },
        },
      ])

      const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
      expect(sectionXml).toContain('Bold Paragraph')
      expect(sectionXml).toContain('hp:charPrIDRef="8"')
    } finally {
      await unlink(filePath)
    }
  })

  it('addParagraph keeps existing paragraphs unchanged', async () => {
    const filePath = tmpPath('mutator-addParagraph-unchanged')
    const fixture = await createTestHwpx({ paragraphs: ['First', 'Second'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [{ type: 'addParagraph', ref: 's0.p1', text: 'Inserted', position: 'before' }])

      const outPath = tmpPath('mutator-addParagraph-unchanged-out')
      const buffer = await zip.generateAsync({ type: 'nodebuffer' })
      await writeFile(outPath, buffer)

      const archive2 = await loadHwpx(outPath)
      const sections = await parseSections(archive2)
      const texts = sections[0].paragraphs.map((p) => p.runs.map((r) => r.text).join(''))
      expect(texts[0]).toBe('First')
      expect(texts[2]).toBe('Second')

      await unlink(outPath)
    } finally {
      await unlink(filePath)
    }
  })

  it('applies setFormat to inline range with run splitting', async () => {
    const filePath = tmpPath('mutator-inline-split')
    const fixture = await createTestHwpx({ paragraphs: ['HelloWorld'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [{ type: 'setFormat', ref: 's0.p0', format: { bold: true }, start: 0, end: 5 }])

      const outPath = tmpPath('mutator-inline-split-out')
      await writeFile(outPath, await zip.generateAsync({ type: 'nodebuffer' }))

      const sections = await parseSections(await loadHwpx(outPath))
      const runs = sections[0].paragraphs[0].runs
      expect(runs.map((run) => run.text)).toEqual(['Hello', 'World'])
      expect(runs[0].charShapeRef).toBeGreaterThan(0)
      expect(runs[1].charShapeRef).toBe(0)

      await unlink(outPath)
    } finally {
      await unlink(filePath)
    }
  })

  it('keeps setFormat backward compatibility without offsets', async () => {
    const filePath = tmpPath('mutator-inline-backward')
    const fixture = await createTestHwpx({ paragraphs: ['HelloWorld'] })
    await Bun.write(filePath, fixture)
    await setFirstParagraphRuns(filePath, ['Hello', 'World'])

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [{ type: 'setFormat', ref: 's0.p0', format: { bold: true } }])

      const outPath = tmpPath('mutator-inline-backward-out')
      await writeFile(outPath, await zip.generateAsync({ type: 'nodebuffer' }))

      const sections = await parseSections(await loadHwpx(outPath))
      const runs = sections[0].paragraphs[0].runs
      expect(runs).toHaveLength(2)
      expect(runs.map((run) => run.text)).toEqual(['Hello', 'World'])
      expect(runs.every((run) => run.charShapeRef > 0)).toBe(true)

      await unlink(outPath)
    } finally {
      await unlink(filePath)
    }
  })

  it('throws on out-of-range inline offsets', async () => {
    const filePath = tmpPath('mutator-inline-range-error')
    const fixture = await createTestHwpx({ paragraphs: ['Hello'] })
    await Bun.write(filePath, fixture)

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await expect(
        mutateHwpxZip(zip, archive, [{ type: 'setFormat', ref: 's0.p0', format: { bold: true }, start: 0, end: 6 }]),
      ).rejects.toThrow('Offset out of range')
    } finally {
      await unlink(filePath)
    }
  })

  it('formats exact run range without splitting', async () => {
    const filePath = tmpPath('mutator-inline-exact-run')
    const fixture = await createTestHwpx({ paragraphs: ['HelloWorld'] })
    await Bun.write(filePath, fixture)
    await setFirstParagraphRuns(filePath, ['Hello', 'World'])

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [
        { type: 'setFormat', ref: 's0.p0', format: { italic: true }, start: 0, end: 5 },
      ])

      const outPath = tmpPath('mutator-inline-exact-run-out')
      await writeFile(outPath, await zip.generateAsync({ type: 'nodebuffer' }))

      const sections = await parseSections(await loadHwpx(outPath))
      const runs = sections[0].paragraphs[0].runs
      expect(runs).toHaveLength(2)
      expect(runs.map((run) => run.text)).toEqual(['Hello', 'World'])
      expect(runs[0].charShapeRef).toBeGreaterThan(0)
      expect(runs[1].charShapeRef).toBe(0)

      await unlink(outPath)
    } finally {
      await unlink(filePath)
    }
  })

  it('formats ranges spanning multiple runs', async () => {
    const filePath = tmpPath('mutator-inline-multi-run')
    const fixture = await createTestHwpx({ paragraphs: ['HelloWorld'] })
    await Bun.write(filePath, fixture)
    await setFirstParagraphRuns(filePath, ['Hello', 'World'])

    try {
      const archive = await loadHwpx(filePath)
      const zip = archive.getZip()

      await mutateHwpxZip(zip, archive, [
        { type: 'setFormat', ref: 's0.p0', format: { underline: true }, start: 3, end: 7 },
      ])

      const outPath = tmpPath('mutator-inline-multi-run-out')
      await writeFile(outPath, await zip.generateAsync({ type: 'nodebuffer' }))

      const sections = await parseSections(await loadHwpx(outPath))
      const runs = sections[0].paragraphs[0].runs
      expect(runs.map((run) => run.text).join('')).toBe('HelloWorld')
      expect(runs.map((run) => run.text)).toEqual(['Hel', 'lo', 'Wo', 'rld'])
      expect(runs[0].charShapeRef).toBe(0)
      expect(runs[1].charShapeRef).toBeGreaterThan(0)
      expect(runs[2].charShapeRef).toBeGreaterThan(0)
      expect(runs[3].charShapeRef).toBe(0)

      await unlink(outPath)
    } finally {
      await unlink(filePath)
    }
  })

  it('parseXml/buildXml entity roundtrip survives 3+ cycles without double-encoding', () => {
    // Given: XML with entities
    let xml = '<root><text>Test &amp; entity</text></root>'

    // When: parse and build 3 times
    for (let i = 0; i < 3; i++) {
      const parsed = parseXml(xml)
      xml = buildXml(parsed)
    }

    // Then: entities should not be double-encoded
    expect(xml).toContain('&amp;')
    expect(xml).not.toContain('&amp;amp;')
  })

  it('user-supplied text with <, >, & special chars survives write+read roundtrip', () => {
    // Given: user text containing XML special characters
    const userText = 'A & B <tag> C > D'

    // When: store in #text node and roundtrip through parse/build
    const node: XmlNode = { 'hp:t': [{ '#text': escapeXml(userText) }] }
    const xml = buildXml([node])
    const parsed = parseXml(xml)

    // Then: text should be recoverable (still escaped in tree due to processEntities: false)
    const textContent = parsed[0]?.['hp:t']?.[0]?.['#text']
    expect(textContent).toBe('A &amp; B &lt;tag&gt; C &gt; D')

    // And: when read through a normal parser (processEntities: true), should decode correctly
    const normalParser = new XMLParser({ preserveOrder: true, processEntities: true })
    const normalParsed = normalParser.parse(xml) as XmlNode[]
    const decodedText = normalParsed[0]?.['hp:t']?.[0]?.['#text']
    expect(decodedText).toBe(userText)
  })
})
