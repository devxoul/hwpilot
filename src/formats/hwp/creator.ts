import CFB from 'cfb'
import { buildRecord } from './record-serializer'
import { compressStream } from './stream-util'
import { TAG } from './tag-ids'

export type CreateHwpOptions = {
  paragraphs?: string[]
  font?: string
  fontSize?: number
  compressed?: boolean
}

export async function createHwp(options: CreateHwpOptions = {}): Promise<Buffer> {
  const paragraphs = options.paragraphs ?? []
  const font = options.font ?? '맑은 고딕'
  const fontSize = options.fontSize ?? 1000
  const compressed = options.compressed ?? true

  const docInfo = buildDocInfoStream(font, fontSize)
  const section0 = buildSection0Stream(paragraphs)

  const cfb = CFB.utils.cfb_new()
  CFB.utils.cfb_add(cfb, 'FileHeader', createHwpFileHeader(compressed))
  CFB.utils.cfb_add(cfb, '\u0005HwpSummaryInformation', Buffer.alloc(0))
  CFB.utils.cfb_add(cfb, 'DocInfo', compressed ? compressStream(docInfo) : docInfo)
  CFB.utils.cfb_add(cfb, 'BodyText/Section0', compressed ? compressStream(section0) : section0)

  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}

function buildDocInfoStream(font: string, fontSize: number): Buffer {
  const idMappings = Buffer.alloc(4 * 15)
  idMappings.writeUInt32LE(0, 0)
  idMappings.writeUInt32LE(1, 4)
  idMappings.writeUInt32LE(1, 8)
  idMappings.writeUInt32LE(1, 12)
  idMappings.writeUInt32LE(1, 16)
  idMappings.writeUInt32LE(1, 20)
  idMappings.writeUInt32LE(1, 24)
  idMappings.writeUInt32LE(1, 28)
  idMappings.writeUInt32LE(0, 32)
  idMappings.writeUInt32LE(1, 36)
  idMappings.writeUInt32LE(0, 40)
  idMappings.writeUInt32LE(0, 44)
  idMappings.writeUInt32LE(0, 48)
  idMappings.writeUInt32LE(1, 52)
  idMappings.writeUInt32LE(1, 56)

  const faceName = Buffer.concat([Buffer.from([0x00]), encodeLengthPrefixedUtf16(font)])

  const charShape = Buffer.alloc(74)
  for (const offset of [0, 2, 4, 6, 8, 10, 12]) {
    charShape.writeUInt16LE(0, offset)
  }
  charShape.writeUInt32LE(fontSize, 42)
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
    ...Array.from({ length: 7 }, () => buildRecord(TAG.FACE_NAME, 1, faceName)),
    buildRecord(TAG.CHAR_SHAPE, 1, charShape),
    buildRecord(TAG.PARA_SHAPE, 1, paraShape),
    buildRecord(TAG.STYLE, 1, style),
  ])
}

function buildSection0Stream(paragraphs: string[]): Buffer {
  const records = paragraphs.map((paragraph) => buildParagraphRecords(paragraph))
  return Buffer.concat(records)
}

function buildParagraphRecords(text: string): Buffer {
  const textData = Buffer.from(text, 'utf16le')
  const nChars = textData.length / 2

  const paraHeader = Buffer.alloc(24)
  paraHeader.writeUInt32LE(nChars, 0)

  const paraCharShape = Buffer.alloc(6)
  paraCharShape.writeUInt16LE(0, 4)

  return Buffer.concat([
    buildRecord(TAG.PARA_HEADER, 0, paraHeader),
    buildRecord(TAG.PARA_CHAR_SHAPE, 1, paraCharShape),
    buildRecord(TAG.PARA_TEXT, 1, textData),
  ])
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
