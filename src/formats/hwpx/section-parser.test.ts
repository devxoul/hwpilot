import { describe, expect, it } from 'bun:test'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestHwpx } from '../../test-helpers'
import { loadHwpx } from './loader'
import { parseSection, parseSections } from './section-parser'

describe('parseSection', () => {
  it('parses paragraphs from section XML', () => {
    const xml = `<?xml version="1.0"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p hp:id="0" hp:paraPrIDRef="0" hp:styleIDRef="0">
    <hp:run hp:charPrIDRef="0"><hp:t>Hello</hp:t></hp:run>
  </hp:p>
  <hp:p hp:id="1" hp:paraPrIDRef="0" hp:styleIDRef="0">
    <hp:run hp:charPrIDRef="0"><hp:t>World</hp:t></hp:run>
  </hp:p>
</hs:sec>`

    const section = parseSection(xml, 0)
    expect(section.paragraphs).toHaveLength(2)
    expect(section.paragraphs[0].ref).toBe('s0.p0')
    expect(section.paragraphs[0].runs[0].text).toBe('Hello')
    expect(section.paragraphs[1].ref).toBe('s0.p1')
    expect(section.paragraphs[1].runs[0].text).toBe('World')
    expect(section.tables).toHaveLength(0)
    expect(section.images).toHaveLength(0)
  })

  it('assigns correct refs for section index > 0', () => {
    const xml = `<?xml version="1.0"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p hp:id="0" hp:paraPrIDRef="0" hp:styleIDRef="0">
    <hp:run hp:charPrIDRef="0"><hp:t>Para</hp:t></hp:run>
  </hp:p>
</hs:sec>`

    const section = parseSection(xml, 2)
    expect(section.paragraphs[0].ref).toBe('s2.p0')
  })

  it('parses multiple runs in a paragraph', () => {
    const xml = `<?xml version="1.0"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p hp:id="0" hp:paraPrIDRef="0" hp:styleIDRef="0">
    <hp:run hp:charPrIDRef="0"><hp:t>First</hp:t></hp:run>
    <hp:run hp:charPrIDRef="1"><hp:t>Second</hp:t></hp:run>
  </hp:p>
</hs:sec>`

    const section = parseSection(xml, 0)
    expect(section.paragraphs[0].runs).toHaveLength(2)
    expect(section.paragraphs[0].runs[0].text).toBe('First')
    expect(section.paragraphs[0].runs[0].charShapeRef).toBe(0)
    expect(section.paragraphs[0].runs[1].text).toBe('Second')
    expect(section.paragraphs[0].runs[1].charShapeRef).toBe(1)
  })

  it('parses tables', () => {
    const xml = `<?xml version="1.0"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:tbl>
    <hp:tr>
      <hp:tc>
        <hp:cellAddr hp:colAddr="0" hp:rowAddr="0"/>
        <hp:cellSpan hp:colSpan="1" hp:rowSpan="1"/>
        <hp:p hp:id="0" hp:paraPrIDRef="0" hp:styleIDRef="0">
          <hp:run hp:charPrIDRef="0"><hp:t>Cell A</hp:t></hp:run>
        </hp:p>
      </hp:tc>
      <hp:tc>
        <hp:cellAddr hp:colAddr="1" hp:rowAddr="0"/>
        <hp:cellSpan hp:colSpan="1" hp:rowSpan="1"/>
        <hp:p hp:id="0" hp:paraPrIDRef="0" hp:styleIDRef="0">
          <hp:run hp:charPrIDRef="0"><hp:t>Cell B</hp:t></hp:run>
        </hp:p>
      </hp:tc>
    </hp:tr>
  </hp:tbl>
</hs:sec>`

    const section = parseSection(xml, 0)
    expect(section.tables).toHaveLength(1)
    expect(section.tables[0].ref).toBe('s0.t0')
    expect(section.tables[0].rows).toHaveLength(1)
    expect(section.tables[0].rows[0].cells).toHaveLength(2)
    expect(section.tables[0].rows[0].cells[0].ref).toBe('s0.t0.r0.c0')
    expect(section.tables[0].rows[0].cells[1].ref).toBe('s0.t0.r0.c1')
    expect(section.tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('Cell A')
    expect(section.tables[0].rows[0].cells[1].paragraphs[0].runs[0].text).toBe('Cell B')
    expect(section.tables[0].rows[0].cells[0].colSpan).toBe(1)
    expect(section.tables[0].rows[0].cells[0].rowSpan).toBe(1)
  })

  it('handles empty text runs gracefully', () => {
    const xml = `<?xml version="1.0"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p hp:id="0" hp:paraPrIDRef="0" hp:styleIDRef="0">
    <hp:run hp:charPrIDRef="0"><hp:t></hp:t></hp:run>
  </hp:p>
</hs:sec>`

    const section = parseSection(xml, 0)
    expect(section.paragraphs[0].runs[0].text).toBe('')
  })

  it('parses text boxes from section-level rect drawText', () => {
    const xml = `<?xml version="1.0"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:rect>
    <hp:drawText>
      <hp:subList>
        <hp:p hp:id="0" hp:paraPrIDRef="0" hp:styleIDRef="0">
          <hp:run hp:charPrIDRef="0"><hp:t>Text box paragraph</hp:t></hp:run>
        </hp:p>
      </hp:subList>
    </hp:drawText>
  </hp:rect>
</hs:sec>`

    const section = parseSection(xml, 0)
    expect(section.textBoxes).toHaveLength(1)
    expect(section.textBoxes[0].ref).toBe('s0.tb0')
    expect(section.textBoxes[0].paragraphs).toHaveLength(1)
    expect(section.textBoxes[0].paragraphs[0].ref).toBe('s0.tb0.p0')
    expect(section.textBoxes[0].paragraphs[0].runs[0].text).toBe('Text box paragraph')
    expect(section.paragraphs).toHaveLength(0)
    expect(section.tables).toHaveLength(0)
    expect(section.images).toHaveLength(0)
  })

  it('parses text boxes from rect inside paragraph', () => {
    const xml = `<?xml version="1.0"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:p hp:id="0" hp:paraPrIDRef="0" hp:styleIDRef="0">
    <hp:run hp:charPrIDRef="0"><hp:t>Outside paragraph</hp:t></hp:run>
    <hp:rect>
      <hp:drawText>
        <hp:subList>
          <hp:p hp:id="1" hp:paraPrIDRef="1" hp:styleIDRef="1">
            <hp:run hp:charPrIDRef="1"><hp:t>Inline text box paragraph</hp:t></hp:run>
          </hp:p>
        </hp:subList>
      </hp:drawText>
    </hp:rect>
  </hp:p>
</hs:sec>`

    const section = parseSection(xml, 0)
    expect(section.paragraphs).toHaveLength(1)
    expect(section.paragraphs[0].ref).toBe('s0.p0')
    expect(section.paragraphs[0].runs[0].text).toBe('Outside paragraph')
    expect(section.textBoxes).toHaveLength(1)
    expect(section.textBoxes[0].ref).toBe('s0.tb0')
    expect(section.textBoxes[0].paragraphs[0].ref).toBe('s0.tb0.p0')
    expect(section.textBoxes[0].paragraphs[0].runs[0].text).toBe('Inline text box paragraph')
  })
})

describe('parseSections', () => {
  it('parses all sections from archive', async () => {
    const buf = await createTestHwpx({ paragraphs: ['Hello', 'World'] })
    const path = join(tmpdir(), 'test-sections.hwpx')
    await writeFile(path, buf)

    try {
      const archive = await loadHwpx(path)
      const sections = await parseSections(archive)
      expect(sections).toHaveLength(1)
      expect(sections[0].paragraphs).toHaveLength(2)
      expect(sections[0].paragraphs[0].runs[0].text).toBe('Hello')
    } finally {
      await unlink(path)
    }
  })
})
