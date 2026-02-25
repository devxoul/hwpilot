import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import CFB from 'cfb'
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

  const { docInfo } = patchDocInfo(cfb, templateCompressed, font, baseFontSize)
  CFB.utils.cfb_del(cfb, '/DocInfo')
  CFB.utils.cfb_add(cfb, '/DocInfo', compressed ? compressStream(docInfo) : docInfo)

  const section0 = buildSection0Stream(sectionDef)
  CFB.utils.cfb_del(cfb, '/BodyText/Section0')
  CFB.utils.cfb_add(cfb, '/BodyText/Section0', compressed ? compressStream(section0) : section0)

  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
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
): { docInfo: Buffer } {
  const docInfoEntry = CFB.find(cfb, '/DocInfo')
  if (!docInfoEntry?.content) throw new Error('Template missing DocInfo')
  let stream = Buffer.from(docInfoEntry.content)
  if (templateCompressed) stream = Buffer.from(decompressStream(stream))
  const parts: Buffer[] = []
  let faceNameIndex = 0
  let charShapeIndex = 0
  for (const { header, data, offset } of iterateRecords(stream)) {
    const recordBuf = stream.subarray(offset, offset + header.headerSize + header.size)
    if (header.tagId === TAG.FACE_NAME && font) {
      if (faceNameIndex === 0) {
        const newFaceName = Buffer.concat([Buffer.from([0x00]), encodeLengthPrefixedUtf16(font)])
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
        if (font) patched.writeUInt16LE(0, 0)
        if (fontSize) patched.writeUInt32LE(fontSize, 42)
        parts.push(buildRecord(TAG.CHAR_SHAPE, header.level, patched))
      } else {
        parts.push(recordBuf)
      }
      charShapeIndex++
      continue
    }

    parts.push(recordBuf)
  }

  return { docInfo: Buffer.concat(parts) }
}

function encodeLengthPrefixedUtf16(text: string): Buffer {
  const value = Buffer.from(text, 'utf16le')
  const length = Buffer.alloc(2)
  length.writeUInt16LE(text.length, 0)
  return Buffer.concat([length, value])
}

function buildSection0Stream(sectionDef: Buffer): Buffer {
  // Single empty paragraph with section definition
  const sectionCtrlChar = Buffer.alloc(16)
  sectionCtrlChar.writeUInt16LE(0x0002, 0)
  sectionCtrlChar.write('dces', 2, 'ascii')
  sectionCtrlChar.writeUInt16LE(0x0002, 14)
  const paraText = Buffer.concat([sectionCtrlChar, Buffer.from([0x0d, 0x00])])
  const nChars = paraText.length / 2
  const paraHeader = buildParaHeader(nChars, true)
  paraHeader.writeUInt32LE(0x00080004, 4)
  return Buffer.concat([
    buildRecord(TAG.PARA_HEADER, 0, paraHeader),
    buildRecord(TAG.PARA_TEXT, 1, paraText),
    buildRecord(TAG.PARA_CHAR_SHAPE, 1, buildParaCharShape(0, nChars)),
    buildRecord(TAG.PARA_LINE_SEG, 1, buildParaLineSeg()),
    sectionDef,
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

// HWP 5.0 PARA_LINE_SEG binary layout (36 bytes per segment):
// [0:4] textStartPos  [4:8] lineVerticalPos  [8:12] lineHeight
// [12:16] textPartHeight  [16:20] distanceFromBaseline
// [20:24] lineSpacing  [24:28] columnStart  [28:32] segmentWidth
// [32:34] tag  [34:36] flags
function buildParaLineSeg(): Buffer {
  const buf = Buffer.alloc(36)
  buf.writeUInt32LE(0x000009a0, 8)
  buf.writeUInt32LE(0x000009a0, 12)
  buf.writeUInt32LE(0x000007f8, 16)
  buf.writeInt32LE(-0x00000690, 20)
  buf.writeUInt16LE(0x0006, 34)
  return buf
}

function createHwpFileHeader(compressed: boolean): Buffer {
  const fileHeader = Buffer.alloc(256)
  fileHeader.write('HWP Document File', 0, 'ascii')
  fileHeader.writeUInt32LE(0x05010001, 32)
  fileHeader.writeUInt32LE(compressed ? 0x1 : 0, 36)
  fileHeader.writeUInt32LE(4, 44)
  return fileHeader
}
