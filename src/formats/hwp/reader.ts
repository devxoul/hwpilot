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

type BinDataEntry = {
  path: string
  format: string
}

type DocInfoParseResult = {
  header: DocumentHeader
  binDataById: Map<number, BinDataEntry>
}

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
  const { header, binDataById } = parseDocInfo(docInfoBuffer)

  const sections: Section[] = []
  let sectionIndex = 0

  while (true) {
    const sectionEntry = CFB.find(cfb, `/BodyText/Section${sectionIndex}`)
    if (!sectionEntry?.content) {
      break
    }

    const sectionBuffer = getStreamBuffer(sectionEntry, isCompressed)
    sections.push(parseSection(sectionBuffer, sectionIndex, binDataById))
    sectionIndex += 1
  }

  return { format: 'hwp', sections, header }
}

export async function loadHwpSectionTexts(filePath: string): Promise<string[]> {
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
  const sections: string[] = []

  let sectionIndex = 0
  while (true) {
    const sectionEntry = CFB.find(cfb, `/BodyText/Section${sectionIndex}`)
    if (!sectionEntry?.content) {
      break
    }

    const sectionBuffer = getStreamBuffer(sectionEntry, isCompressed)
    const sectionTextParts: string[] = []
    for (const { header, data } of iterateRecords(sectionBuffer)) {
      if (header.tagId !== TAG.PARA_TEXT) {
        continue
      }

      const text = extractParaText(data)
      if (text) {
        sectionTextParts.push(text)
      }
    }

    sections.push(sectionTextParts.join('\n'))
    sectionIndex += 1
  }

  return sections
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

function parseDocInfo(buffer: Buffer): DocInfoParseResult {
  const fonts: FontFace[] = []
  const charShapes: CharShape[] = []
  const paraShapes: ParaShape[] = []
  const styles: Style[] = []
  const binDataById = new Map<number, BinDataEntry>()

  let fontId = 0
  let charShapeId = 0
  let paraShapeId = 0
  let styleId = 0

  for (const { header, data } of iterateRecords(buffer)) {
    if (header.tagId === TAG.BIN_DATA) {
      const parsed = parseBinDataRecord(data)
      if (parsed) {
        binDataById.set(parsed.id, { path: parsed.path, format: parsed.format })
      }
      continue
    }

    if (header.tagId === TAG.FACE_NAME) {
      if (data.length < 3) {
        continue
      }

      const nameLen = data.readUInt16LE(1)
      const nameStart = 3
      const nameEnd = nameStart + nameLen * 2
      if (nameEnd > data.length) {
        continue
      }

      const name = data.subarray(nameStart, nameEnd).toString('utf16le')
      if (!name) {
        continue
      }

      fonts.push({ id: fontId, name })
      fontId += 1
      continue
    }

    if (header.tagId === TAG.CHAR_SHAPE) {
      if (data.length < 56) {
        continue
      }

      const fontRef = data.readUInt16LE(0)
      const height = data.readUInt32LE(42)
      const attrBits = data.readUInt32LE(46)
      const bold = Boolean(attrBits & 0x1)
      const italic = Boolean(attrBits & 0x2)
      const underline = Boolean((attrBits >> 2) & 0x3)
      const colorInt = data.readUInt32LE(52)
      const r = colorInt & 0xff
      const g = (colorInt >> 8) & 0xff
      const b = (colorInt >> 16) & 0xff
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

  return {
    header: { fonts, charShapes, paraShapes, styles },
    binDataById,
  }
}

function parseSection(buffer: Buffer, sectionIndex: number, binDataById: Map<number, BinDataEntry>): Section {
  const paragraphs: Paragraph[] = []
  const tables: Table[] = []
  const images: Image[] = []

  let paraIndex = 0
  const activeParagraphs = new Map<
    number,
    { runs: Run[]; charShapeRef: number; paraShapeRef: number; styleRef: number; target: 'section' | 'cell' }
  >()

  let pendingTableControlLevel: number | null = null
  let activeTable: {
    level: number
    tableIndex: number
    rowCount: number
    colCount: number
    nextCellIndex: number
  } | null = null
  let activeCell: {
    paragraphLevel: number
    paragraphs: Paragraph[]
  } | null = null

  let pendingShapeSize: { width: number; height: number } | null = null

  const flushParagraphLevel = (level: number): void => {
    const paragraph = activeParagraphs.get(level)
    if (!paragraph) {
      return
    }

    const destination = paragraph.target === 'section' ? paragraphs : (activeCell?.paragraphs ?? null)
    if (destination) {
      if (paragraph.target === 'section') {
        destination.push({
          ref: buildRef({ section: sectionIndex, paragraph: paraIndex }),
          runs: paragraph.runs,
          paraShapeRef: paragraph.paraShapeRef,
          styleRef: paragraph.styleRef,
        })
        paraIndex += 1
      } else if (activeTable) {
        destination.push({
          ref: buildRef({
            section: sectionIndex,
            table: activeTable.tableIndex,
            row: Math.floor((activeTable.nextCellIndex - 1) / activeTable.colCount),
            cell: (activeTable.nextCellIndex - 1) % activeTable.colCount,
            cellParagraph: destination.length,
          }),
          runs: paragraph.runs,
          paraShapeRef: paragraph.paraShapeRef,
          styleRef: paragraph.styleRef,
        })
      }
    }

    activeParagraphs.delete(level)
  }

  const flushParagraphsAbove = (level: number): void => {
    for (const activeLevel of [...activeParagraphs.keys()].sort((a, b) => b - a)) {
      if (activeLevel > level) {
        flushParagraphLevel(activeLevel)
      }
    }
  }

  const getParagraphForContentRecord = (
    level: number,
  ): {
    runs: Run[]
    charShapeRef: number
    paraShapeRef: number
    styleRef: number
    target: 'section' | 'cell'
  } | null => {
    return activeParagraphs.get(level) ?? activeParagraphs.get(level - 1) ?? null
  }

  for (const { header, data } of iterateRecords(buffer)) {
    flushParagraphsAbove(header.level)

    if (
      activeTable &&
      activeTable.nextCellIndex >= activeTable.rowCount * activeTable.colCount &&
      header.level <= activeTable.level &&
      header.tagId !== TAG.LIST_HEADER
    ) {
      activeTable = null
      activeCell = null
    }

    if (header.tagId === TAG.PARA_HEADER) {
      flushParagraphLevel(header.level)
      const target =
        activeCell && header.level === activeCell.paragraphLevel ? 'cell' : header.level === 0 ? 'section' : 'cell'
      const paraShapeRef = data.length >= 10 ? data.readUInt16LE(8) : 0
      const styleRef = data.length >= 11 ? data.readUInt8(10) : 0
      activeParagraphs.set(header.level, {
        runs: [],
        charShapeRef: 0,
        paraShapeRef,
        styleRef,
        target,
      })
      continue
    }

    if (header.tagId === TAG.PARA_CHAR_SHAPE) {
      const paragraph = getParagraphForContentRecord(header.level)
      if (!paragraph) {
        continue
      }

      if (data.length >= 6) {
        paragraph.charShapeRef = data.readUInt16LE(4)
      }
      continue
    }

    if (header.tagId === TAG.PARA_TEXT) {
      const paragraph = getParagraphForContentRecord(header.level)
      if (!paragraph) {
        continue
      }

      const text = extractParaText(data)
      if (text) {
        paragraph.runs.push({ text, charShapeRef: paragraph.charShapeRef })
      }
      continue
    }

    if (header.tagId === TAG.CTRL_HEADER) {
      if (data.subarray(0, 4).toString('ascii') === 'tbl ') {
        pendingTableControlLevel = header.level
      }
      continue
    }

    if (
      header.tagId === TAG.TABLE &&
      pendingTableControlLevel !== null &&
      header.level === pendingTableControlLevel + 1 &&
      data.length >= 6
    ) {
      const rowCount = data.readUInt16LE(2)
      const colCount = data.readUInt16LE(4)
      const tableIndex = tables.length
      const rows = Array.from({ length: rowCount }, () => ({
        cells: [] as NonNullable<Table['rows'][number]['cells']>,
      }))

      tables.push({
        ref: buildRef({ section: sectionIndex, table: tableIndex }),
        rows,
      })

      activeTable = {
        level: header.level,
        tableIndex,
        rowCount,
        colCount,
        nextCellIndex: 0,
      }
      activeCell = null
      pendingTableControlLevel = null
      continue
    }

    if (header.tagId === TAG.LIST_HEADER && activeTable && header.level === activeTable.level) {
      const cellIndex = activeTable.nextCellIndex
      activeTable.nextCellIndex += 1

      if (activeTable.colCount > 0) {
        const rowIndex = Math.floor(cellIndex / activeTable.colCount)
        const colIndex = cellIndex % activeTable.colCount
        const cellParagraphs: Paragraph[] = []

        if (rowIndex < activeTable.rowCount) {
          tables[activeTable.tableIndex].rows[rowIndex].cells.push({
            ref: buildRef({ section: sectionIndex, table: activeTable.tableIndex, row: rowIndex, cell: colIndex }),
            paragraphs: cellParagraphs,
            colSpan: 1,
            rowSpan: 1,
          })

          activeCell = {
            paragraphLevel: header.level + 1,
            paragraphs: cellParagraphs,
          }
        }
      }
      continue
    }

    if (header.tagId === TAG.SHAPE_COMPONENT) {
      pendingShapeSize = parseShapeSize(data)
      continue
    }

    if (header.tagId === TAG.SHAPE_COMPONENT_PICTURE) {
      const binDataId = parsePictureBinDataId(data, binDataById)
      if (binDataId !== null) {
        const entry = binDataById.get(binDataId)
        const format = entry?.format ?? ''
        images.push({
          ref: buildRef({ section: sectionIndex, image: images.length }),
          binDataPath: entry?.path ?? `BinData/image${binDataId}`,
          width: pendingShapeSize?.width ?? 0,
          height: pendingShapeSize?.height ?? 0,
          format,
        })
      }
      pendingShapeSize = null
    }
  }

  for (const level of [...activeParagraphs.keys()].sort((a, b) => b - a)) {
    flushParagraphLevel(level)
  }

  return { paragraphs, tables, images }
}

function parseBinDataRecord(data: Buffer): { id: number; path: string; format: string } | null {
  if (data.length < 4) {
    return null
  }

  const typeFlags = data.readUInt16LE(0)
  const storageType = typeFlags & 0x3
  if (storageType !== 1 && storageType !== 2) {
    return null
  }

  const id = data.readUInt16LE(2)
  if (id === 0) {
    return null
  }

  const extension = readUtf16LengthPrefixed(data, 4)
  const normalized = extension.trim().replace(/^\./, '').toLowerCase()
  const suffix = normalized ? `.${normalized}` : ''

  return {
    id,
    path: `BinData/image${id}${suffix}`,
    format: normalized,
  }
}

function readUtf16LengthPrefixed(data: Buffer, offset: number): string {
  if (offset + 2 > data.length) {
    return ''
  }

  const length = data.readUInt16LE(offset)
  const textStart = offset + 2
  const textEnd = textStart + length * 2
  if (textEnd > data.length) {
    return ''
  }

  return data.subarray(textStart, textEnd).toString('utf16le')
}

function parseShapeSize(data: Buffer): { width: number; height: number } | null {
  const widthOffset = 20
  const heightOffset = 24
  if (data.length < heightOffset + 4) {
    return null
  }

  const width = data.readInt32LE(widthOffset)
  const height = data.readInt32LE(heightOffset)
  if (width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function parsePictureBinDataId(data: Buffer, binDataById: Map<number, BinDataEntry>): number | null {
  const binDataIdOffset = 4 * 17 + 3
  if (data.length < binDataIdOffset + 2) {
    return null
  }

  const id = data.readUInt16LE(binDataIdOffset)
  if (id === 0) {
    return null
  }

  if (binDataById.has(id)) {
    return id
  }

  return null
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
