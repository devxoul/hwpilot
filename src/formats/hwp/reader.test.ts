import { afterEach, describe, expect, it } from 'bun:test'
import CFB from 'cfb'
import { extractParaText, loadHwp } from './reader'
import { buildRecord } from './record-serializer'
import { TAG } from './tag-ids'

const TMP_FILES: string[] = []

afterEach(async () => {
  await Promise.all(
    TMP_FILES.splice(0).map(async (file) => {
      await Bun.file(file).delete()
    }),
  )
})

describe('loadHwp', () => {
  it('throws for invalid signature', async () => {
    const filePath = '/tmp/test-invalid-signature.hwp'
    TMP_FILES.push(filePath)
    const buffer = createHwpCfbBuffer(0, 'Not HWP Signature')
    await Bun.write(filePath, buffer)

    await expect(loadHwp(filePath)).rejects.toThrow('Invalid HWP file: wrong signature')
  })

  it('throws for encrypted files', async () => {
    const filePath = '/tmp/test-encrypted.hwp'
    TMP_FILES.push(filePath)
    const buffer = createHwpCfbBuffer(0x2, 'HWP Document File')
    await Bun.write(filePath, buffer)

    await expect(loadHwp(filePath)).rejects.toThrow('Password-protected files not supported')
  })

  it('exports expected public functions', () => {
    expect(typeof loadHwp).toBe('function')
    expect(typeof extractParaText).toBe('function')
  })

  it('parses 2x2 table cells and keeps table cell paragraphs out of section paragraphs', async () => {
    const filePath = '/tmp/test-hwp-table.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([
      paragraphRecord(0, 'Before table'),
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x000b, 0x0000])),
      buildRecord(TAG.CTRL_HEADER, 1, Buffer.from('tbl ', 'ascii')),
      buildRecord(TAG.TABLE, 2, tableData(2, 2)),
      cellRecord(2, 'A1'),
      cellRecord(2, 'A2'),
      cellRecord(2, 'B1'),
      cellRecord(2, 'B2'),
      paragraphRecord(0, 'After table'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const section = doc.sections[0]

    expect(section.tables).toHaveLength(1)
    expect(section.tables[0].rows).toHaveLength(2)
    expect(section.tables[0].rows[0].cells).toHaveLength(2)
    expect(section.tables[0].rows[1].cells).toHaveLength(2)
    expect(section.tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('A1')
    expect(section.tables[0].rows[0].cells[1].paragraphs[0].runs[0].text).toBe('A2')
    expect(section.tables[0].rows[1].cells[0].paragraphs[0].runs[0].text).toBe('B1')
    expect(section.tables[0].rows[1].cells[1].paragraphs[0].runs[0].text).toBe('B2')

    const paragraphTexts = section.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    expect(paragraphTexts).toContain('Before table')
    expect(paragraphTexts).toContain('After table')
    expect(paragraphTexts).not.toContain('A1')
    expect(paragraphTexts).not.toContain('A2')
    expect(paragraphTexts).not.toContain('B1')
    expect(paragraphTexts).not.toContain('B2')
  })

  it('parses paraShapeRef and styleRef from PARA_HEADER record data', async () => {
    const filePath = '/tmp/test-hwp-para-shape-ref.hwp'
    TMP_FILES.push(filePath)

    const paraHeaderData = Buffer.alloc(12)
    paraHeaderData.writeUInt32LE(5, 0)
    paraHeaderData.writeUInt32LE(0, 4)
    paraHeaderData.writeUInt16LE(2, 8)
    paraHeaderData.writeUInt8(1, 10)

    const sectionRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, paraHeaderData),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x0041, 0x0000])),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const paragraph = doc.sections[0].paragraphs[0]

    expect(paragraph.paraShapeRef).toBe(2)
    expect(paragraph.styleRef).toBe(1)
  })

  it('parses image records using DocInfo BIN_DATA and shape records', async () => {
    const filePath = '/tmp/test-hwp-image.hwp'
    TMP_FILES.push(filePath)

    const docInfoRecords = buildRecord(TAG.BIN_DATA, 0, binDataRecord(1, 'png'))
    const sectionRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.SHAPE_COMPONENT, 1, shapeComponentData(320, 240)),
      buildRecord(TAG.SHAPE_COMPONENT_PICTURE, 2, shapePictureData(1)),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, docInfoRecords, sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const image = doc.sections[0].images[0]

    expect(doc.sections[0].images).toHaveLength(1)
    expect(image.ref).toBe('s0.img0')
    expect(image.binDataPath).toBe('BinData/image1.png')
    expect(image.width).toBe(320)
    expect(image.height).toBe(240)
    expect(image.format).toBe('png')
  })
})

describe('extractParaText', () => {
  it('extracts UTF-16LE text and skips inline control payload', () => {
    const data = encodeUint16([
      0x0041, 0x0001, 0x1111, 0x2222, 0x3333, 0x4444, 0x5555, 0x6666, 0x7777, 0x0042, 0x0009, 0x0043, 0x0000,
    ])

    expect(extractParaText(data)).toBe('ABC')
  })
})

function createHwpCfbBuffer(flags: number, signature: string): Buffer {
  const cfb = CFB.utils.cfb_new()
  const fileHeader = Buffer.alloc(256)
  fileHeader.write(signature, 0, 'ascii')
  fileHeader.writeUInt32LE(flags, 36)

  CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
  CFB.utils.cfb_add(cfb, 'DocInfo', Buffer.alloc(0))

  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}

function createHwpCfbBufferWithRecords(flags: number, docInfo: Buffer, section0: Buffer): Buffer {
  const cfb = CFB.utils.cfb_new()
  const fileHeader = Buffer.alloc(256)
  fileHeader.write('HWP Document File', 0, 'ascii')
  fileHeader.writeUInt32LE(flags, 36)

  CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
  CFB.utils.cfb_add(cfb, 'DocInfo', docInfo)
  CFB.utils.cfb_add(cfb, '/BodyText/Section0', section0)

  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}

function encodeUint16(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2)
  for (const [index, value] of values.entries()) {
    buffer.writeUInt16LE(value, index * 2)
  }
  return buffer
}

function encodeUtf16le(text: string): Buffer {
  const utf16 = Buffer.from(text, 'utf16le')
  const length = Buffer.alloc(2)
  length.writeUInt16LE(text.length, 0)
  return Buffer.concat([length, utf16])
}

function paragraphRecord(level: number, text: string): Buffer {
  return Buffer.concat([
    buildRecord(TAG.PARA_HEADER, level, Buffer.alloc(0)),
    buildRecord(TAG.PARA_TEXT, level + 1, encodeUint16([...text].map((ch) => ch.charCodeAt(0)).concat(0x0000))),
  ])
}

function tableData(rows: number, cols: number): Buffer {
  const data = Buffer.alloc(6)
  data.writeUInt16LE(rows, 2)
  data.writeUInt16LE(cols, 4)
  return data
}

function cellRecord(level: number, text: string): Buffer {
  return Buffer.concat([buildRecord(TAG.LIST_HEADER, level, Buffer.alloc(0)), paragraphRecord(level + 1, text)])
}

function binDataRecord(binId: number, extension: string): Buffer {
  const flags = Buffer.alloc(2)
  flags.writeUInt16LE(1, 0)

  const id = Buffer.alloc(2)
  id.writeUInt16LE(binId, 0)

  return Buffer.concat([flags, id, encodeUtf16le(extension)])
}

function shapeComponentData(width: number, height: number): Buffer {
  const data = Buffer.alloc(8)
  data.writeInt32LE(width, 0)
  data.writeInt32LE(height, 4)
  return data
}

function shapePictureData(binId: number): Buffer {
  const data = Buffer.alloc(2)
  data.writeUInt16LE(binId, 0)
  return data
}
