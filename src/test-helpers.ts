import CFB from 'cfb'
import JSZip from 'jszip'
import { buildRecord } from '@/formats/hwp/record-serializer'
import { compressStream } from '@/formats/hwp/stream-util'
import { TAG } from '@/formats/hwp/tag-ids'

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
  font?: string
  fontSize?: number
}

export type TestHwpOptions = {
  paragraphs?: string[]
  tables?: TestTable[]
  compressed?: boolean
}

export async function createTestHwpx(opts: TestHwpxOptions = {}): Promise<Buffer> {
  const zip = new JSZip()

  const paragraphs = opts.paragraphs ?? ['']
  const tables = opts.tables ?? []
  const images = opts.images ?? []
  const fontName = opts.font ?? '맑은 고딕'
  const fontHeight = opts.fontSize ?? 1000

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
      <hh:fontface hh:id="0" hh:face="${escapeXml(fontName)}"/>
    </hh:fontfaces>
    <hh:charProperties>
      <hh:charPr hh:id="0" hh:height="${fontHeight}" hh:fontRef="0"
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
    <hp:pic xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" hp:id="${img.name}" hp:binDataPath="${binPath}" hp:format="${img.format}" hp:width="200" hp:height="150">
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

export async function createTestHwpBinary(opts: TestHwpOptions = {}): Promise<Buffer> {
  const paragraphs = opts.paragraphs ?? []
  const tables = opts.tables ?? []
  const compressed = opts.compressed ?? false

  const docInfo = buildDocInfoStream()
  const section0 = buildSection0Stream(paragraphs, tables)

  const cfb = CFB.utils.cfb_new()
  CFB.utils.cfb_add(cfb, 'FileHeader', createHwpFileHeader(compressed))
  CFB.utils.cfb_add(cfb, '\u0005HwpSummaryInformation', Buffer.alloc(0))
  CFB.utils.cfb_add(cfb, 'DocInfo', compressed ? compressStream(docInfo) : docInfo)
  CFB.utils.cfb_add(cfb, 'BodyText/Section0', compressed ? compressStream(section0) : section0)

  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}

export function createTestHwpCfb(): Buffer {
  const cfb = CFB.utils.cfb_new()
  const fileHeader = Buffer.alloc(256)
  fileHeader.write('HWP Document File', 0, 'ascii')
  fileHeader.writeUInt32LE(0, 36) // flags: no compression, no encryption
  CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
  CFB.utils.cfb_add(cfb, 'DocInfo', Buffer.alloc(0))
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildDocInfoStream(): Buffer {
  const idMappings = Buffer.alloc(4 * 4)
  idMappings.writeUInt32LE(1, 0)
  idMappings.writeUInt32LE(1, 4)
  idMappings.writeUInt32LE(1, 8)
  idMappings.writeUInt32LE(1, 12)

  const faceName = encodeLengthPrefixedUtf16('맑은 고딕')

  const charShape = Buffer.alloc(74)
  charShape.writeUInt16LE(0, 0)
  charShape.writeUInt16LE(0, 2)
  charShape.writeUInt32LE(1000, 42)
  charShape.writeUInt32LE(0, 46)
  charShape.writeUInt32LE(0, 52)

  const paraShape = Buffer.alloc(4)
  paraShape.writeUInt32LE(0, 0)

  const styleName = encodeLengthPrefixedUtf16('Normal')
  const style = Buffer.alloc(styleName.length + 6)
  styleName.copy(style, 0)
  style.writeUInt16LE(0, styleName.length + 2)
  style.writeUInt16LE(0, styleName.length + 4)

  return Buffer.concat([
    buildRecord(TAG.ID_MAPPINGS, 0, idMappings),
    buildRecord(TAG.FACE_NAME, 0, faceName),
    buildRecord(TAG.CHAR_SHAPE, 0, charShape),
    buildRecord(TAG.PARA_SHAPE, 0, paraShape),
    buildRecord(TAG.STYLE, 0, style),
  ])
}

function buildSection0Stream(paragraphs: string[], tables: TestTable[]): Buffer {
  const records: Buffer[] = []

  for (const paragraph of paragraphs) {
    records.push(buildParagraphRecords(paragraph))
  }

  for (const table of tables) {
    records.push(buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)))
    records.push(buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x000b])))
    records.push(buildRecord(TAG.CTRL_HEADER, 1, Buffer.from('tbl ', 'ascii')))
    records.push(buildRecord(TAG.TABLE, 2, buildTableData(table.rows.length, table.rows[0]?.length ?? 0)))

    for (const row of table.rows) {
      for (const cellText of row) {
        records.push(buildRecord(TAG.LIST_HEADER, 2, Buffer.alloc(0)))
        records.push(buildRecord(TAG.PARA_HEADER, 3, Buffer.alloc(0)))
        records.push(buildRecord(TAG.PARA_TEXT, 3, Buffer.from(cellText, 'utf16le')))
      }
    }
  }

  return Buffer.concat(records)
}

function buildParagraphRecords(text: string): Buffer {
  const paraCharShape = Buffer.alloc(6)
  paraCharShape.writeUInt16LE(0, 4)

  return Buffer.concat([
    buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
    buildRecord(TAG.PARA_CHAR_SHAPE, 1, paraCharShape),
    buildRecord(TAG.PARA_TEXT, 1, Buffer.from(text, 'utf16le')),
  ])
}

function buildTableData(rowCount: number, colCount: number): Buffer {
  const table = Buffer.alloc(6)
  table.writeUInt16LE(rowCount, 2)
  table.writeUInt16LE(colCount, 4)
  return table
}

function createHwpFileHeader(compressed: boolean): Buffer {
  const fileHeader = Buffer.alloc(256)
  fileHeader.write('HWP Document File', 0, 'ascii')
  fileHeader.writeUInt32LE(0x05040000, 32)
  fileHeader.writeUInt32LE(compressed ? 0x1 : 0, 36)
  return fileHeader
}

function encodeLengthPrefixedUtf16(text: string): Buffer {
  const value = Buffer.from(text, 'utf16le')
  const length = Buffer.alloc(2)
  length.writeUInt16LE(text.length, 0)
  return Buffer.concat([length, value])
}

function encodeUint16(values: number[]): Buffer {
  const output = Buffer.alloc(values.length * 2)
  for (const [index, value] of values.entries()) {
    output.writeUInt16LE(value, index * 2)
  }
  return output
}
