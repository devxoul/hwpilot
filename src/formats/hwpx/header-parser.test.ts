import { describe, expect, it } from 'bun:test'
import { parseHeader } from './header-parser'

const HEADER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:fontfaces>
      <hh:fontface hh:id="0" hh:face="맑은 고딕"/>
      <hh:fontface hh:id="1" hh:face="Arial"/>
    </hh:fontfaces>
    <hh:charProperties>
      <hh:charPr hh:id="0" hh:height="1000" hh:fontRef="0"
        hh:fontBold="0" hh:fontItalic="0" hh:underline="0" hh:color="0"/>
      <hh:charPr hh:id="1" hh:height="1400" hh:fontRef="0"
        hh:fontBold="1" hh:fontItalic="1" hh:underline="1" hh:color="16711680"/>
    </hh:charProperties>
    <hh:paraProperties>
      <hh:paraPr hh:id="0" hh:align="JUSTIFY"/>
      <hh:paraPr hh:id="1" hh:align="CENTER"/>
    </hh:paraProperties>
    <hh:styles>
      <hh:style hh:id="0" hh:name="Normal" hh:charPrIDRef="0" hh:paraPrIDRef="0"/>
      <hh:style hh:id="1" hh:name="Heading 1" hh:charPrIDRef="1" hh:paraPrIDRef="1"/>
    </hh:styles>
  </hh:refList>
</hh:head>`

describe('parseHeader', () => {
  it('parses fonts correctly', () => {
    const header = parseHeader(HEADER_XML)
    expect(header.fonts).toHaveLength(2)
    expect(header.fonts[0]).toEqual({ id: 0, name: '맑은 고딕' })
    expect(header.fonts[1]).toEqual({ id: 1, name: 'Arial' })
  })

  it('parses charShapes correctly', () => {
    const header = parseHeader(HEADER_XML)
    expect(header.charShapes).toHaveLength(2)

    const shape0 = header.charShapes[0]
    expect(shape0.id).toBe(0)
    expect(shape0.fontRef).toBe(0)
    expect(shape0.fontSize).toBe(10) // 1000 HWPUNIT / 100 = 10pt
    expect(shape0.bold).toBe(false)
    expect(shape0.italic).toBe(false)
    expect(shape0.underline).toBe(false)
    expect(shape0.color).toBe('#000000') // 0 = black

    const shape1 = header.charShapes[1]
    expect(shape1.id).toBe(1)
    expect(shape1.fontSize).toBe(14) // 1400 / 100 = 14pt
    expect(shape1.bold).toBe(true)
    expect(shape1.italic).toBe(true)
    expect(shape1.underline).toBe(true)
    expect(shape1.color).toBe('#ff0000') // 16711680 = 0xFF0000 = red
  })

  it('parses paraShapes correctly', () => {
    const header = parseHeader(HEADER_XML)
    expect(header.paraShapes).toHaveLength(2)
    expect(header.paraShapes[0]).toEqual({ id: 0, align: 'justify' })
    expect(header.paraShapes[1]).toEqual({ id: 1, align: 'center' })
  })

  it('parses styles correctly', () => {
    const header = parseHeader(HEADER_XML)
    expect(header.styles).toHaveLength(2)
    expect(header.styles[0]).toEqual({ id: 0, name: 'Normal', charShapeRef: 0, paraShapeRef: 0 })
    expect(header.styles[1]).toEqual({ id: 1, name: 'Heading 1', charShapeRef: 1, paraShapeRef: 1 })
  })

  it('handles empty refList', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:fontfaces/>
    <hh:charProperties/>
    <hh:paraProperties/>
    <hh:styles/>
  </hh:refList>
</hh:head>`
    const header = parseHeader(xml)
    expect(header.fonts).toHaveLength(0)
    expect(header.charShapes).toHaveLength(0)
    expect(header.paraShapes).toHaveLength(0)
    expect(header.styles).toHaveLength(0)
  })
})
