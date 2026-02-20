import JSZip from 'jszip'

export type TestTable = {
  rows: string[][]
}

export type TestImage = {
  name: string
  data: Buffer
  format: string
}

export type TestHwpxOptions = {
  paragraphs?: string[]
  tables?: TestTable[]
  images?: TestImage[]
}

export async function createTestHwpx(opts: TestHwpxOptions = {}): Promise<Buffer> {
  const zip = new JSZip()

  const paragraphs = opts.paragraphs ?? ['']
  const tables = opts.tables ?? []
  const images = opts.images ?? []

  zip.file(
    'version.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hv:version xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"
  major="5" minor="1" micro="0" buildNumber="0"/>`,
  )

  zip.file(
    'META-INF/manifest.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/hwp+zip"/>
  <manifest:file-entry manifest:full-path="Contents/header.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="Contents/section0.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`,
  )

  zip.file(
    'Contents/content.hpf',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/">
  <opf:manifest>
    <opf:item id="header" href="header.xml" media-type="text/xml"/>
    <opf:item id="section0" href="section0.xml" media-type="text/xml"/>
  </opf:manifest>
  <opf:spine>
    <opf:itemref idref="section0"/>
  </opf:spine>
</opf:package>`,
  )

  zip.file(
    'Contents/header.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:fontfaces>
      <hh:fontface hh:id="0" hh:face="맑은 고딕"/>
    </hh:fontfaces>
    <hh:charProperties>
      <hh:charPr hh:id="0" hh:height="1000" hh:fontRef="0"
        hh:fontBold="0" hh:fontItalic="0" hh:underline="0" hh:color="0"/>
    </hh:charProperties>
    <hh:paraProperties>
      <hh:paraPr hh:id="0" hh:align="JUSTIFY"/>
    </hh:paraProperties>
    <hh:styles>
      <hh:style hh:id="0" hh:name="Normal" hh:charPrIDRef="0" hh:paraPrIDRef="0"/>
    </hh:styles>
  </hh:refList>
</hh:head>`,
  )

  let sectionContent = ''

  paragraphs.forEach((text, i) => {
    sectionContent += `
    <hp:p xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
      hp:id="${i}" hp:paraPrIDRef="0" hp:styleIDRef="0">
      <hp:run hp:charPrIDRef="0"><hp:t>${escapeXml(text)}</hp:t></hp:run>
    </hp:p>`
  })

  tables.forEach((table) => {
    sectionContent += `
    <hp:tbl xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">`
    table.rows.forEach((row, ri) => {
      sectionContent += `
      <hp:tr>`
      row.forEach((cellText, ci) => {
        sectionContent += `
        <hp:tc>
          <hp:cellAddr hp:colAddr="${ci}" hp:rowAddr="${ri}"/>
          <hp:cellSpan hp:colSpan="1" hp:rowSpan="1"/>
          <hp:p hp:id="0" hp:paraPrIDRef="0" hp:styleIDRef="0">
            <hp:run hp:charPrIDRef="0"><hp:t>${escapeXml(cellText)}</hp:t></hp:run>
          </hp:p>
        </hp:tc>`
      })
      sectionContent += `
      </hp:tr>`
    })
    sectionContent += `
    </hp:tbl>`
  })

  images.forEach((img) => {
    const binPath = `BinData/${img.name}.${img.format}`
    zip.file(binPath, img.data)
    sectionContent += `
    <hp:pic xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" hp:id="${img.name}">
      <hp:imgRect><hc:pt0 xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"/></hp:imgRect>
    </hp:pic>`
  })

  zip.file(
    'Contents/section0.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
        xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"
        xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">${sectionContent}
</hs:sec>`,
  )

  return zip.generateAsync({ type: 'nodebuffer' })
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
