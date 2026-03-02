import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import CFB from 'cfb'
import { writeCfb } from './cfb-writer'
import { controlIdBuffer } from './control-id'
import { iterateRecords } from './record-parser'
import { buildRecord } from './record-serializer'
import { compressStream, decompressStream, getCompressionFlag } from './stream-util'
import { TAG } from './tag-ids'

export type CreateHwpOptions = {
  font?: string
  fontSize?: number
  compressed?: boolean
}

export async function createHwp(options: CreateHwpOptions = {}): Promise<Buffer> {
  const font = options.font
  const baseFontSize = options.fontSize
  const compressed = options.compressed ?? true
  const templateBuffer = await loadTemplate()
  const cfb = CFB.read(templateBuffer, { type: 'buffer' })
  const templateCompressed = readCompressionFlag(cfb)
  const sectionDef = extractSectionDefinition(cfb, templateCompressed)
  CFB.utils.cfb_del(cfb, '/FileHeader')
  CFB.utils.cfb_add(cfb, '/FileHeader', createHwpFileHeader(compressed))

  const { docInfo, bodyCharShapeRef } = patchDocInfo(cfb, templateCompressed, font, baseFontSize)
  CFB.utils.cfb_del(cfb, '/DocInfo')
  CFB.utils.cfb_add(cfb, '/DocInfo', compressed ? compressStream(docInfo) : docInfo)

  const section0 = buildSection0Stream(sectionDef, bodyCharShapeRef)
  CFB.utils.cfb_del(cfb, '/BodyText/Section0')
  CFB.utils.cfb_add(cfb, '/BodyText/Section0', compressed ? compressStream(section0) : section0)

  return writeCfb(cfb)
}

async function loadTemplate(): Promise<Buffer> {
  const dir = dirname(fileURLToPath(import.meta.url))
  return readFile(join(dir, 'template.hwp'))
}

function readCompressionFlag(cfb: CFB.CFB$Container): boolean {
  const fhEntry = CFB.find(cfb, '/FileHeader')
  if (!fhEntry?.content) throw new Error('Template missing FileHeader')
  return getCompressionFlag(Buffer.from(fhEntry.content))
}

// HWP Section0 requires section-definition control records (PAGE_DEF, FOOTNOTE_SHAPE,
// PAGE_BORDER_FILL) inside the first paragraph's CTRL_HEADER. Without these, Hancom Viewer
// treats the file as a text import rather than a native HWP document.
function extractSectionDefinition(cfb: CFB.CFB$Container, templateCompressed: boolean): Buffer {
  const entry = CFB.find(cfb, '/BodyText/Section0')
  if (!entry?.content) throw new Error('Template missing Section0')
  let stream = Buffer.from(entry.content)
  if (templateCompressed) stream = Buffer.from(decompressStream(stream))

  const parts: Buffer[] = []
  let foundFirstPara = false
  let sectionCtrlFound = false

  for (const { header, data, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      if (foundFirstPara) break
      foundFirstPara = true
      continue
    }

    if (!foundFirstPara) continue

    // 'dces' = section definition control ID (reversed 'secd')
    if (header.tagId === TAG.CTRL_HEADER && header.level === 1 && !sectionCtrlFound) {
      if (data.length >= 4 && data.subarray(0, 4).toString('ascii') === 'dces') {
        sectionCtrlFound = true
        parts.push(stream.subarray(offset, offset + header.headerSize + header.size))
        continue
      }
    }

    if (sectionCtrlFound && header.level >= 2) {
      if (
        header.tagId === TAG.PAGE_DEF ||
        header.tagId === TAG.FOOTNOTE_SHAPE ||
        header.tagId === TAG.PAGE_BORDER_FILL
      ) {
        parts.push(stream.subarray(offset, offset + header.headerSize + header.size))
        continue
      }
    }

    if (sectionCtrlFound && header.level <= 1) break
  }

  return Buffer.concat(parts)
}

function patchDocInfo(
  cfb: CFB.CFB$Container,
  templateCompressed: boolean,
  font: string | undefined,
  fontSize: number | undefined,
): { docInfo: Buffer; bodyCharShapeRef: number } {
  const docInfoEntry = CFB.find(cfb, '/DocInfo')
  if (!docInfoEntry?.content) throw new Error('Template missing DocInfo')
  let stream = Buffer.from(docInfoEntry.content)
  if (templateCompressed) stream = Buffer.from(decompressStream(stream))
  const parts: Buffer[] = []
  let faceNameIndex = 0
  let charShapeIndex = 0
  let styleIndex = 0
  let bodyCharShapeRef = 0

  for (const { header, data, offset } of iterateRecords(stream)) {
    const recordBuf = stream.subarray(offset, offset + header.headerSize + header.size)
    if (header.tagId === TAG.FACE_NAME && font) {
      if (faceNameIndex % 7 === 0) {
        const encodedName = Buffer.from(font, 'utf16le')
        const length = Buffer.alloc(2)
        length.writeUInt16LE(font.length, 0)
        const newFaceName = Buffer.concat([Buffer.from([0x00]), length, encodedName])
        parts.push(buildRecord(TAG.FACE_NAME, header.level, newFaceName))
      } else {
        parts.push(recordBuf)
      }
      faceNameIndex++
      continue
    }

    if (header.tagId === TAG.CHAR_SHAPE) {
      if (charShapeIndex === 0) {
        const patched = Buffer.from(data)
        if (fontSize !== undefined) patched.writeUInt32LE(fontSize, 42)
        parts.push(buildRecord(TAG.CHAR_SHAPE, header.level, patched))
      } else {
        parts.push(recordBuf)
      }
      charShapeIndex++
      continue
    }

    if (header.tagId === TAG.STYLE) {
      if (styleIndex === 0) {
        bodyCharShapeRef = parseStyleCharShapeRef(data)
      }
      parts.push(recordBuf)
      styleIndex++
      continue
    }

    parts.push(recordBuf)
  }

  return { docInfo: Buffer.concat(parts), bodyCharShapeRef }
}

function buildSection0Stream(sectionDef: Buffer, bodyCharShapeRef: number): Buffer {
  const sectionCtrlChar = Buffer.alloc(16)
  sectionCtrlChar.writeUInt16LE(0x0002, 0)
  controlIdBuffer('secd').copy(sectionCtrlChar, 2)
  sectionCtrlChar.writeUInt16LE(0x0002, 14)
  const columnCtrlChar = Buffer.alloc(16)
  columnCtrlChar.writeUInt16LE(0x0002, 0)
  controlIdBuffer('cold').copy(columnCtrlChar, 2)
  columnCtrlChar.writeUInt16LE(0x0002, 14)
  const paraText = Buffer.concat([sectionCtrlChar, columnCtrlChar, Buffer.from([0x0d, 0x00])])
  const nChars = paraText.length / 2
  const paraHeader = buildParaHeader(nChars, true)
  paraHeader.writeUInt32LE(0x00000004, 4)
  const dlocCtrlData = Buffer.alloc(16)
  controlIdBuffer('cold').copy(dlocCtrlData, 0)
  dlocCtrlData.writeUInt32LE(0x00001004, 4)
  return Buffer.concat([
    buildRecord(TAG.PARA_HEADER, 0, paraHeader),
    buildRecord(TAG.PARA_TEXT, 1, paraText),
    buildRecord(TAG.PARA_CHAR_SHAPE, 1, buildParaCharShape(bodyCharShapeRef, nChars)),
    sectionDef,
    buildRecord(TAG.CTRL_HEADER, 1, dlocCtrlData),
  ])
}

// HWP 5.0 PARA_HEADER binary layout (24 bytes):
// [0:4] nChars (bit 31 = last paragraph flag)
// [4:8] controlMask
// [8:10] paraShapeRef
// [10] styleRef
// [16:20] nLineSegs
function buildParaHeader(nChars: number, isLast: boolean): Buffer {
  const buf = Buffer.alloc(24)
  buf.writeUInt32LE(isLast ? (nChars | 0x80000000) >>> 0 : nChars, 0)
  buf.writeUInt32LE(0, 4)
  buf.writeUInt16LE(0, 8)
  buf.writeUInt8(0, 10)
  buf.writeUInt32LE(1, 16)
  return buf
}

// PARA_CHAR_SHAPE: array of (position, charShapeRef) pairs.
// First paragraph needs 2 entries: one for ctrl+text region, one for trailing linebreak.
// Subsequent paragraphs need only 1 entry covering all chars.
function buildParaCharShape(charShapeRef: number, nChars?: number): Buffer {
  if (nChars !== undefined) {
    const buf = Buffer.alloc(16)
    buf.writeUInt32LE(0, 0)
    buf.writeUInt32LE(charShapeRef, 4)
    buf.writeUInt32LE(nChars - 1, 8)
    buf.writeUInt32LE(charShapeRef, 12)
    return buf
  }
  const buf = Buffer.alloc(8)
  buf.writeUInt32LE(0, 0)
  buf.writeUInt32LE(charShapeRef, 4)
  return buf
}

function parseStyleCharShapeRef(data: Buffer): number {
  const nameLen = data.readUInt16LE(0)
  let offset = 2 + nameLen * 2
  if (offset + 2 > data.length) return 0
  const englishNameLen = data.readUInt16LE(offset)
  offset += 2 + englishNameLen * 2
  const remaining = data.length - offset
  if (remaining >= 10) {
    const primary = data.readUInt16LE(offset + 4)
    const fallback = data.readUInt16LE(offset + 6)
    if (primary === 0 && fallback !== 0) return fallback
    return primary
  }
  if (remaining >= 2) {
    return data.readUInt16LE(offset)
  }
  return 0
}

function createHwpFileHeader(compressed: boolean): Buffer {
  const fileHeader = Buffer.alloc(256)
  fileHeader.write('HWP Document File', 0, 'ascii')
  fileHeader.writeUInt32LE(0x05010100, 32)
  fileHeader.writeUInt32LE(compressed ? 0x1 : 0, 36)
  fileHeader.writeUInt32LE(4, 44)
  return fileHeader
}
