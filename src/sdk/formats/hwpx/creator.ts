import JSZip from 'jszip'

import { escapeXml } from './mutator'

export type CreateHwpxOptions = {
  font?: string
  fontSize?: number
}

export async function createHwpx(options: CreateHwpxOptions = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  const fontName = options.font ?? '맑은 고딕'
  const fontHeight = options.fontSize !== undefined ? options.fontSize * 100 : 1000

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

  const headingFontSizes = [2200, 1800, 1600, 1400, 1300, 1200, 1100]

  const headingCharPrs = headingFontSizes
    .map(
      (size, i) =>
        `      <hh:charPr hh:id="${i + 1}" hh:height="${size}" hh:fontRef="0"
        hh:fontBold="1" hh:fontItalic="0" hh:underline="0" hh:color="0"/>`,
    )
    .join('\n')

  const headingParaPrs = headingFontSizes
    .map(
      (_, i) =>
        `      <hh:paraPr hh:id="${i + 1}" hh:align="LEFT">
        <hh:heading hh:type="OUTLINE" hh:idRef="0" hh:level="${i + 1}"/>
      </hh:paraPr>`,
    )
    .join('\n')

  const headingStyles = headingFontSizes
    .map(
      (_, i) =>
        `      <hh:style hh:id="${i + 1}" hh:name="\uAC1C\uC694 ${i + 1}" hh:charPrIDRef="${i + 1}" hh:paraPrIDRef="${i + 1}" hh:type="PARA"/>`,
    )
    .join('\n')

  zip.file(
    'Contents/header.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:refList>
    <hh:fontfaces>
      <hh:fontface hh:id="0" hh:face="${escapeXml(fontName)}"/>
    </hh:fontfaces>
    <hh:charProperties>
      <hh:charPr hh:id="0" hh:height="${fontHeight}" hh:fontRef="0"
        hh:fontBold="0" hh:fontItalic="0" hh:underline="0" hh:color="0"/>
${headingCharPrs}
    </hh:charProperties>
    <hh:paraProperties>
      <hh:paraPr hh:id="0" hh:align="JUSTIFY"/>
${headingParaPrs}
    </hh:paraProperties>
    <hh:styles>
      <hh:style hh:id="0" hh:name="Normal" hh:charPrIDRef="0" hh:paraPrIDRef="0"/>
${headingStyles}
    </hh:styles>
  </hh:refList>
</hh:head>`,
  )

  zip.file(
    'Contents/section0.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
        xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"
        xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
    <hp:p xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
      hp:id="0" hp:paraPrIDRef="0" hp:styleIDRef="0">
      <hp:run hp:charPrIDRef="0"><hp:t></hp:t></hp:run>
    </hp:p>
</hs:sec>`,
  )

  return zip.generateAsync({ type: 'uint8array' })
}
