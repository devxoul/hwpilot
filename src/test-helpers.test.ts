import { describe, expect, it } from 'bun:test'
import JSZip from 'jszip'
import { createTestHwpx } from './test-helpers'

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
