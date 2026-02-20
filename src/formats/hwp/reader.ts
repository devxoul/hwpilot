import { readFile } from 'node:fs/promises'
import CFB from 'cfb'
import { inflateRaw } from 'pako'
import { buildRef } from '@/shared/refs'
import type {
  CharShape,
  DocumentHeader,
  FontFace,
  HwpDocument,
  Image,
  Paragraph,
  ParaShape,
  Run,
  Section,
  Style,
  Table,
} from '@/types'
import { iterateRecords } from './record-parser'
import { TAG } from './tag-ids'

const HWP_SIGNATURE = 'HWP Document File'

export async function loadHwp(filePath: string): Promise<HwpDocument> {
  const fileBuffer = await readFile(filePath)
  const cfb = CFB.read(fileBuffer, { type: 'buffer' })

  const fileHeaderEntry = CFB.find(cfb, 'FileHeader')
  if (!fileHeaderEntry?.content) {
    throw new Error('Invalid HWP file: FileHeader not found')
  }

  const headerContent = Buffer.from(fileHeaderEntry.content)
  const signature = headerContent.subarray(0, 17).toString('ascii').replace(/\0/g, '')
  if (!signature.startsWith(HWP_SIGNATURE)) {
    throw new Error('Invalid HWP file: wrong signature')
  }

  const flags = headerContent.readUInt32LE(36)
  if (flags & 0x2) {
    throw new Error('Password-protected files not supported')
  }

  const isCompressed = Boolean(flags & 0x1)
  const docInfoEntry = CFB.find(cfb, 'DocInfo')
  const docInfoBuffer = getStreamBuffer(docInfoEntry, isCompressed)
  const header = parseDocInfo(docInfoBuffer)

  const sections: Section[] = []
  let sectionIndex = 0

  while (true) {
    const sectionEntry = CFB.find(cfb, `/BodyText/Section${sectionIndex}`)
    if (!sectionEntry?.content) {
      break
    }

    const sectionBuffer = getStreamBuffer(sectionEntry, isCompressed)
    sections.push(parseSection(sectionBuffer, sectionIndex))
    sectionIndex += 1
  }

  return { format: 'hwp', sections, header }
}

function getStreamBuffer(entry: CFB.CFB$Entry | null | undefined, isCompressed: boolean): Buffer {
  if (!entry?.content) {
    throw new Error('Stream entry not found or empty')
  }

  const raw = Buffer.from(entry.content)
  if (!isCompressed) {
    return raw
  }

  return Buffer.from(inflateRaw(raw))
}

function parseDocInfo(buffer: Buffer): DocumentHeader {
  const fonts: FontFace[] = []
  const charShapes: CharShape[] = []
  const paraShapes: ParaShape[] = []
  const styles: Style[] = []

  let fontId = 0
  let charShapeId = 0
  let paraShapeId = 0
  let styleId = 0

  for (const { header, data } of iterateRecords(buffer)) {
    if (header.tagId === TAG.FACE_NAME) {
      if (data.length < 2) {
        continue
      }

      const nameLen = data.readUInt16LE(0)
      const nameEnd = 2 + nameLen * 2
      if (nameEnd > data.length) {
        continue
      }

      const name = data.subarray(2, nameEnd).toString('utf16le')
      fonts.push({ id: fontId, name })
      fontId += 1
      continue
    }

    if (header.tagId === TAG.CHAR_SHAPE) {
      if (data.length < 30) {
        continue
      }

      const fontRef = data.readUInt16LE(2)
      const height = data.readUInt32LE(18)
      const attrBits = data.readUInt32LE(22)
      const bold = Boolean(attrBits & 0x1)
      const italic = Boolean(attrBits & 0x2)
      const underline = Boolean((attrBits >> 2) & 0x3)
      const colorInt = data.readUInt32LE(26)
      const r = (colorInt >> 16) & 0xff
      const g = (colorInt >> 8) & 0xff
      const b = colorInt & 0xff
      const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`

      charShapes.push({
        id: charShapeId,
        fontRef,
        fontSize: height / 100,
        bold,
        italic,
        underline,
        color,
      })
      charShapeId += 1
      continue
    }

    if (header.tagId === TAG.PARA_SHAPE) {
      if (data.length < 4) {
        continue
      }

      const alignBits = data.readUInt32LE(0) & 0x3
      const alignMap: Record<number, 'left' | 'right' | 'center' | 'justify'> = {
        0: 'justify',
        1: 'left',
        2: 'right',
        3: 'center',
      }
      paraShapes.push({ id: paraShapeId, align: alignMap[alignBits] ?? 'left' })
      paraShapeId += 1
      continue
    }

    if (header.tagId === TAG.STYLE) {
      if (data.length < 6) {
        continue
      }

      const nameLen = data.readUInt16LE(0)
      const baseOffset = 2 + nameLen * 2
      if (baseOffset + 6 > data.length) {
        continue
      }

      const name = data.subarray(2, baseOffset).toString('utf16le')
      const charShapeRef = data.readUInt16LE(baseOffset + 2)
      const paraShapeRef = data.readUInt16LE(baseOffset + 4)
      styles.push({ id: styleId, name, charShapeRef, paraShapeRef })
      styleId += 1
    }
  }

  return { fonts, charShapes, paraShapes, styles }
}

function parseSection(buffer: Buffer, sectionIndex: number): Section {
  const paragraphs: Paragraph[] = []
  const tables: Table[] = []
  const images: Image[] = []

  let paraIndex = 0
  let inParagraph = false
  let currentRuns: Run[] = []
  let currentCharShapeRef = 0

  for (const { header, data } of iterateRecords(buffer)) {
    if (header.tagId === TAG.PARA_HEADER) {
      if (inParagraph) {
        paragraphs.push({
          ref: buildRef({ section: sectionIndex, paragraph: paraIndex }),
          runs: currentRuns,
          paraShapeRef: 0,
          styleRef: 0,
        })
        paraIndex += 1
      }

      currentRuns = []
      currentCharShapeRef = 0
      inParagraph = true
      continue
    }

    if (header.tagId === TAG.PARA_CHAR_SHAPE && inParagraph) {
      if (data.length >= 6) {
        currentCharShapeRef = data.readUInt16LE(4)
      }
      continue
    }

    if (header.tagId === TAG.PARA_TEXT && inParagraph) {
      const text = extractParaText(data)
      if (text) {
        currentRuns.push({ text, charShapeRef: currentCharShapeRef })
      }
    }
  }

  if (inParagraph) {
    paragraphs.push({
      ref: buildRef({ section: sectionIndex, paragraph: paraIndex }),
      runs: currentRuns,
      paraShapeRef: 0,
      styleRef: 0,
    })
  }

  return { paragraphs, tables, images }
}

export function extractParaText(data: Buffer): string {
  const chars: string[] = []

  for (let i = 0; i < data.length - 1; i += 2) {
    const code = data.readUInt16LE(i)
    if (code === 0) {
      break
    }

    if (code < 32) {
      if (code !== 9 && code !== 10 && code !== 13) {
        i += 14
      }
      continue
    }

    chars.push(String.fromCharCode(code))
  }

  return chars.join('')
}
