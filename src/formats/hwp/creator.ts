import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import CFB from 'cfb'
import { iterateRecords } from './record-parser'
import { buildRecord } from './record-serializer'
import { compressStream, decompressStream, getCompressionFlag } from './stream-util'
import { TAG } from './tag-ids'

export type ParagraphInput =
  | string
  | {
      text: string
      bold?: boolean
      fontSize?: number
    }
export type CreateHwpOptions = {
  paragraphs?: ParagraphInput[]
  font?: string
  fontSize?: number
  compressed?: boolean
}

export async function createHwp(options: CreateHwpOptions = {}): Promise<Buffer> {
  const rawParagraphs = options.paragraphs ?? []
  const font = options.font
  const baseFontSize = options.fontSize
  const compressed = options.compressed ?? true
  const normalized = rawParagraphs.map((p) => (typeof p === 'string' ? { text: p } : p))
  const templateBuffer = await loadTemplate()
  const cfb = CFB.read(templateBuffer, { type: 'buffer' })
  const templateCompressed = readCompressionFlag(cfb)
  const sectionDef = extractSectionDefinition(cfb, templateCompressed)
  CFB.utils.cfb_del(cfb, '/FileHeader')
  CFB.utils.cfb_add(cfb, '/FileHeader', createHwpFileHeader(compressed))
  // Collect unique per-paragraph charShape variants (bold/fontSize overrides)
  const charShapeMap = new Map<string, number>()
  const charShapeVariants: { bold: boolean; fontSize: number | undefined }[] = []

  const paraCharShapeRefs: number[] = []
  for (const para of normalized) {
    const bold = para.bold ?? false
    const fontSize = para.fontSize !== undefined ? para.fontSize * 100 : baseFontSize
    const key = `${bold}:${fontSize ?? 'default'}`

    if (key === 'false:default' || key === `false:${baseFontSize ?? 'default'}`) {
      paraCharShapeRefs.push(0)
    } else {
      if (!charShapeMap.has(key)) {
        charShapeMap.set(key, charShapeVariants.length)
        charShapeVariants.push({ bold, fontSize })
      }
      paraCharShapeRefs.push(-1 - charShapeMap.get(key)!)
    }
  }

  const { docInfo, baseCharShapeCount } = patchDocInfo(cfb, templateCompressed, font, baseFontSize, charShapeVariants)
  CFB.utils.cfb_del(cfb, '/DocInfo')
  CFB.utils.cfb_add(cfb, '/DocInfo', compressed ? compressStream(docInfo) : docInfo)

  // Resolve negative refs to actual charShape indices
  const resolvedRefs = paraCharShapeRefs.map((ref) => (ref < 0 ? baseCharShapeCount + (-1 - ref) : ref))

  const section0 = buildSection0Stream(normalized, sectionDef, resolvedRefs)
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
  charShapeVariants: { bold: boolean; fontSize: number | undefined }[],
): { docInfo: Buffer; baseCharShapeCount: number } {
  const docInfoEntry = CFB.find(cfb, '/DocInfo')
  if (!docInfoEntry?.content) throw new Error('Template missing DocInfo')
  let stream = Buffer.from(docInfoEntry.content)
  if (templateCompressed) stream = Buffer.from(decompressStream(stream))
  const parts: Buffer[] = []
  let faceNameIndex = 0
  let charShapeIndex = 0
  let charShapeLevel = 1
  let baseCharShapeData: Buffer | null = null
  let lastCharShapePartIndex = -1
  for (const { header, data, offset } of iterateRecords(stream)) {
    const recordBuf = stream.subarray(offset, offset + header.headerSize + header.size)
    // Update ID_MAPPINGS charShape count when adding variants
    if (header.tagId === TAG.ID_MAPPINGS && charShapeVariants.length > 0) {
      const patchedData = Buffer.from(data)
      if (patchedData.length >= 40) {
        const currentCount = patchedData.readUInt32LE(36)
        patchedData.writeUInt32LE(currentCount + charShapeVariants.length, 36)
      }
      parts.push(buildRecord(TAG.ID_MAPPINGS, header.level, patchedData))
      continue
    }
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
      charShapeLevel = header.level
      if (charShapeIndex === 0) {
        const patched = Buffer.from(data)
        if (font) patched.writeUInt16LE(0, 0)
        if (fontSize) patched.writeUInt32LE(fontSize, 42)
        baseCharShapeData = patched
        parts.push(buildRecord(TAG.CHAR_SHAPE, header.level, patched))
      } else {
        parts.push(recordBuf)
      }
      lastCharShapePartIndex = parts.length - 1
      charShapeIndex++
      continue
    }

    parts.push(recordBuf)
  }

  const baseCharShapeCount = charShapeIndex

  // Insert new charShape variants right after the last CHAR_SHAPE record
  if (baseCharShapeData && charShapeVariants.length > 0 && lastCharShapePartIndex >= 0) {
    const variantRecords: Buffer[] = []
    for (const variant of charShapeVariants) {
      const variantData = Buffer.from(baseCharShapeData)
      if (variant.fontSize !== undefined) {
        variantData.writeUInt32LE(variant.fontSize, 42)
      }
      const currentAttrs = variantData.readUInt32LE(46)
      if (variant.bold) {
        variantData.writeUInt32LE(currentAttrs | 0x1, 46)
      } else {
        variantData.writeUInt32LE(currentAttrs & ~0x1, 46)
      }
      variantRecords.push(buildRecord(TAG.CHAR_SHAPE, charShapeLevel, variantData))
    }
    parts.splice(lastCharShapePartIndex + 1, 0, ...variantRecords)
  }
  return { docInfo: Buffer.concat(parts), baseCharShapeCount }
}

function encodeLengthPrefixedUtf16(text: string): Buffer {
  const value = Buffer.from(text, 'utf16le')
  const length = Buffer.alloc(2)
  length.writeUInt16LE(text.length, 0)
  return Buffer.concat([length, value])
}

type NormalizedParagraph = { text: string; bold?: boolean; fontSize?: number }

function buildSection0Stream(paragraphs: NormalizedParagraph[], sectionDef: Buffer, charShapeRefs: number[]): Buffer {
  const parts: Buffer[] = []
  if (paragraphs.length === 0) {
    parts.push(buildFirstParagraph('', sectionDef, true, 0))
  } else {
    parts.push(buildFirstParagraph(paragraphs[0].text, sectionDef, paragraphs.length === 1, charShapeRefs[0] ?? 0))
    for (let i = 1; i < paragraphs.length; i++) {
      parts.push(buildParagraphRecords(paragraphs[i].text, i === paragraphs.length - 1, charShapeRefs[i] ?? 0))
    }
  }
  return Buffer.concat(parts)
}

function buildFirstParagraph(text: string, sectionDef: Buffer, isLast: boolean, charShapeRef: number): Buffer {
  const textBuf = Buffer.from(text, 'utf16le')
  // Extended control char: 16 bytes = [ctrl_code(2)] [id(4)] [padding(8)] [ctrl_code(2)]
  const sectionCtrlChar = Buffer.alloc(16)
  sectionCtrlChar.writeUInt16LE(0x0002, 0)
  sectionCtrlChar.write('dces', 2, 'ascii')
  sectionCtrlChar.writeUInt16LE(0x0002, 14)
  const paraText = Buffer.concat([sectionCtrlChar, textBuf, Buffer.from([0x0d, 0x00])])
  const nChars = paraText.length / 2
  // First paragraph must have controlMask bit for section-def (0x0004 at offset 4)
  const paraHeader = buildParaHeader(nChars, isLast)
  paraHeader.writeUInt32LE(0x00080004, 4)
  return Buffer.concat([
    buildRecord(TAG.PARA_HEADER, 0, paraHeader),
    buildRecord(TAG.PARA_TEXT, 1, paraText),
    buildRecord(TAG.PARA_CHAR_SHAPE, 1, buildParaCharShape(charShapeRef, nChars)),
    buildRecord(TAG.PARA_LINE_SEG, 1, buildParaLineSeg()),
    sectionDef,
  ])
}

function buildParagraphRecords(text: string, isLast: boolean, charShapeRef: number): Buffer {
  if (text.length === 0) {
    const parts = [
      buildRecord(TAG.PARA_HEADER, 0, buildParaHeader(1, isLast)),
      buildRecord(TAG.PARA_CHAR_SHAPE, 1, buildParaCharShape(charShapeRef)),
      buildRecord(TAG.PARA_LINE_SEG, 1, buildParaLineSeg()),
    ]
    return Buffer.concat(parts)
  }
  const textBuf = Buffer.from(text, 'utf16le')
  const paraText = Buffer.concat([textBuf, Buffer.from([0x0d, 0x00])])
  const nChars = paraText.length / 2
  return Buffer.concat([
    buildRecord(TAG.PARA_HEADER, 0, buildParaHeader(nChars, isLast)),
    buildRecord(TAG.PARA_TEXT, 1, paraText),
    buildRecord(TAG.PARA_CHAR_SHAPE, 1, buildParaCharShape(charShapeRef)),
    buildRecord(TAG.PARA_LINE_SEG, 1, buildParaLineSeg()),
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
