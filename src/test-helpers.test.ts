import { describe, expect, it } from 'bun:test'
import JSZip from 'jszip'
import { loadHwp } from './formats/hwp/reader'
import { createTestHwpBinary, createTestHwpx } from './test-helpers'

describe('createTestHwpx', () => {
  it('returns a Buffer', async () => {
    const buf = await createTestHwpx()
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('creates a valid ZIP that JSZip can open', async () => {
    const buf = await createTestHwpx()
    const zip = await JSZip.loadAsync(buf)
    expect(zip).toBeTruthy()
  })

  it('contains all required HWPX entries', async () => {
    const buf = await createTestHwpx()
    const zip = await JSZip.loadAsync(buf)
    expect(zip.file('version.xml')).not.toBeNull()
    expect(zip.file('META-INF/manifest.xml')).not.toBeNull()
    expect(zip.file('Contents/content.hpf')).not.toBeNull()
    expect(zip.file('Contents/header.xml')).not.toBeNull()
    expect(zip.file('Contents/section0.xml')).not.toBeNull()
  })

  it('creates paragraphs from options', async () => {
    const buf = await createTestHwpx({ paragraphs: ['Hello', 'World'] })
    const zip = await JSZip.loadAsync(buf)
    const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
    expect(sectionXml).toContain('Hello')
    expect(sectionXml).toContain('World')
  })

  it('creates tables from options', async () => {
    const buf = await createTestHwpx({
      tables: [
        {
          rows: [
            ['Cell 1', 'Cell 2'],
            ['Cell 3', 'Cell 4'],
          ],
        },
      ],
    })
    const zip = await JSZip.loadAsync(buf)
    const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
    expect(sectionXml).toContain('Cell 1')
    expect(sectionXml).toContain('Cell 4')
    expect(sectionXml).toContain('hp:tbl')
    expect(sectionXml).toContain('hp:tr')
    expect(sectionXml).toContain('hp:tc')
  })

  it('section0.xml has valid OWPML namespace', async () => {
    const buf = await createTestHwpx()
    const zip = await JSZip.loadAsync(buf)
    const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
    expect(sectionXml).toContain('http://www.hancom.co.kr/hwpml/2011/section')
  })

  it('header.xml contains font definition', async () => {
    const buf = await createTestHwpx()
    const zip = await JSZip.loadAsync(buf)
    const headerXml = await zip.file('Contents/header.xml')!.async('string')
    expect(headerXml).toContain('맑은 고딕')
    expect(headerXml).toContain('hh:charPr')
  })

  it('escapes XML special characters in text', async () => {
    const buf = await createTestHwpx({ paragraphs: ['<hello> & "world"'] })
    const zip = await JSZip.loadAsync(buf)
    const sectionXml = await zip.file('Contents/section0.xml')!.async('string')
    expect(sectionXml).toContain('&lt;hello&gt;')
    expect(sectionXml).toContain('&amp;')
  })
})

  it('creates document with multiple paragraphs readable via loader and parser', async () => {
    const buf = await createTestHwpx({ paragraphs: ['Hello', 'World', 'Test'] })
    const filePath = `/tmp/test-helpers-hwpx-multi-${Date.now()}.hwpx`
    await Bun.write(filePath, buf)

    try {
      const { loadHwpx } = await import('@/formats/hwpx/loader')
      const { parseSections } = await import('@/formats/hwpx/section-parser')
      const archive = await loadHwpx(filePath)
      const sections = await parseSections(archive)

      expect(sections).toHaveLength(1)
      expect(sections[0].paragraphs).toHaveLength(3)
      expect(sections[0].paragraphs[0].runs[0]?.text).toBe('Hello')
      expect(sections[0].paragraphs[1].runs[0]?.text).toBe('World')
      expect(sections[0].paragraphs[2].runs[0]?.text).toBe('Test')
    } finally {
      await Bun.file(filePath).delete()
    }
  })

describe('createTestHwpBinary', () => {
  it('creates an HWP fixture with multiple paragraphs loadable by loadHwp()', async () => {
    const filePath = `/tmp/test-hwp-binary-paragraphs-${Date.now()}.hwp`
    const buffer = await createTestHwpBinary({ paragraphs: ['안녕하세요', 'Hello'] })
    await Bun.write(filePath, buffer)

    try {
      const doc = await loadHwp(filePath)
      const runs = doc.sections[0]?.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)) ?? []
      expect(runs).toEqual(['안녕하세요', 'Hello'])
    } finally {
      await Bun.file(filePath).delete()
    }
  })

  it('creates a compressed HWP fixture loadable by loadHwp()', async () => {
    const filePath = `/tmp/test-hwp-binary-compressed-${Date.now()}.hwp`
    const buffer = await createTestHwpBinary({ compressed: true, paragraphs: ['Test'] })
    await Bun.write(filePath, buffer)

    try {
      const doc = await loadHwp(filePath)
      expect(doc.sections[0]?.paragraphs[0]?.runs[0]?.text).toBe('Test')
    } finally {
      await Bun.file(filePath).delete()
    }
  })

  it('creates an HWP fixture with table cells loadable by loadHwp()', async () => {
    const filePath = `/tmp/test-hwp-binary-table-${Date.now()}.hwp`
    const buffer = await createTestHwpBinary({
      tables: [
        {
          rows: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
      ],
    })
    await Bun.write(filePath, buffer)

    try {
      const doc = await loadHwp(filePath)
      const table = doc.sections[0]?.tables[0]

      expect(doc.sections[0]?.tables).toHaveLength(1)
      expect(table?.rows).toHaveLength(2)
      expect(table?.rows[0]?.cells).toHaveLength(2)
      expect(table?.rows[1]?.cells).toHaveLength(2)
      expect(table?.rows[0]?.cells[0]?.paragraphs[0]?.runs[0]?.text).toBe('A')
      expect(table?.rows[0]?.cells[1]?.paragraphs[0]?.runs[0]?.text).toBe('B')
      expect(table?.rows[1]?.cells[0]?.paragraphs[0]?.runs[0]?.text).toBe('C')
      expect(table?.rows[1]?.cells[1]?.paragraphs[0]?.runs[0]?.text).toBe('D')
    } finally {
      await Bun.file(filePath).delete()
    }
  })

  it('creates document with multiple paragraphs readable', async () => {
    const filePath = `/tmp/test-helpers-hwp-multi-${Date.now()}.hwp`
    const buffer = await createTestHwpBinary({ paragraphs: ['First', 'Second', 'Third'] })
    await Bun.write(filePath, buffer)

    try {
      const doc = await loadHwp(filePath)

      expect(doc.sections).toHaveLength(1)
      expect(doc.sections[0].paragraphs).toHaveLength(3)
      expect(doc.sections[0].paragraphs[0].runs[0]?.text).toBe('First')
      expect(doc.sections[0].paragraphs[1].runs[0]?.text).toBe('Second')
      expect(doc.sections[0].paragraphs[2].runs[0]?.text).toBe('Third')
    } finally {
      await Bun.file(filePath).delete()
    }
  })
})
