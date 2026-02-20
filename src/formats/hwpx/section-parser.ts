import { XMLParser } from 'fast-xml-parser'
import { buildRef } from '@/shared/refs'
import type { Image, Paragraph, Run, Section, Table, TableCell, TableRow } from '@/types'
import type { HwpxArchive } from './loader'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  isArray: (name) => ['hp:p', 'hp:run', 'hp:tbl', 'hp:tr', 'hp:tc', 'hp:pic'].includes(name),
})

type XmlNode = Record<string, unknown>

export function parseSection(xml: string, sectionIndex: number): Section {
  const parsed = parser.parse(xml) as Record<string, unknown>
  const sec = (parsed['hs:sec'] ?? {}) as XmlNode

  const rawParagraphs = asArray<XmlNode>(sec['hp:p'])
  const rawTables = asArray<XmlNode>(sec['hp:tbl'])
  const rawPics = asArray<XmlNode>(sec['hp:pic'])

  const paragraphs = rawParagraphs.map((paragraph, paragraphIndex) =>
    parseParagraph(paragraph, {
      section: sectionIndex,
      paragraph: paragraphIndex,
    }),
  )

  const tables = rawTables.map((table, tableIndex) => parseTable(table, sectionIndex, tableIndex))
  const images = rawPics.map((pic, imageIndex) => parseImage(pic, sectionIndex, imageIndex))

  return {
    paragraphs,
    tables,
    images,
  }
}

export async function parseSections(archive: HwpxArchive): Promise<Section[]> {
  const sectionCount = archive.getSectionCount()
  const sections: Section[] = []

  for (let i = 0; i < sectionCount; i++) {
    const xml = await archive.getSectionXml(i)
    sections.push(parseSection(xml, i))
  }

  return sections
}

function parseParagraph(
  paragraph: XmlNode,
  refParts: {
    section: number
    paragraph?: number
    table?: number
    row?: number
    cell?: number
    cellParagraph?: number
  },
): Paragraph {
  const runs = asArray<XmlNode>(paragraph['hp:run']).map(parseRun)

  return {
    ref: buildRef(refParts),
    runs,
    paraShapeRef: asNumber(paragraph['hp:paraPrIDRef'], 0),
    styleRef: asNumber(paragraph['hp:styleIDRef'], 0),
  }
}

function parseRun(run: XmlNode): Run {
  return {
    text: extractText(run['hp:t']),
    charShapeRef: asNumber(run['hp:charPrIDRef'], 0),
  }
}

function parseTable(table: XmlNode, sectionIndex: number, tableIndex: number): Table {
  const rows = asArray<XmlNode>(table['hp:tr']).map((row, rowIndex) =>
    parseTableRow(row, sectionIndex, tableIndex, rowIndex),
  )

  return {
    ref: buildRef({ section: sectionIndex, table: tableIndex }),
    rows,
  }
}

function parseTableRow(row: XmlNode, sectionIndex: number, tableIndex: number, rowIndex: number): TableRow {
  const cells = asArray<XmlNode>(row['hp:tc']).map((cell, cellIndex) =>
    parseTableCell(cell, sectionIndex, tableIndex, rowIndex, cellIndex),
  )

  return { cells }
}

function parseTableCell(
  cell: XmlNode,
  sectionIndex: number,
  tableIndex: number,
  rowIndex: number,
  cellIndex: number,
): TableCell {
  const span = (cell['hp:cellSpan'] ?? {}) as XmlNode
  const rawParagraphs = asArray<XmlNode>(cell['hp:p'])

  const paragraphs = rawParagraphs.map((paragraph, paragraphIndex) =>
    parseParagraph(paragraph, {
      section: sectionIndex,
      table: tableIndex,
      row: rowIndex,
      cell: cellIndex,
      cellParagraph: paragraphIndex,
    }),
  )

  return {
    ref: buildRef({ section: sectionIndex, table: tableIndex, row: rowIndex, cell: cellIndex }),
    paragraphs,
    colSpan: asNumber(span['hp:colSpan'], 1),
    rowSpan: asNumber(span['hp:rowSpan'], 1),
  }
}

function parseImage(pic: XmlNode, sectionIndex: number, imageIndex: number): Image {
  const width = asNumber(pic['hp:width'], 0)
  const height = asNumber(pic['hp:height'], 0)
  const format = asString(pic['hp:format'])

  const directPath = asString(pic['hp:binDataPath'])
  const binDataPath = directPath || deriveBinDataPath(pic)

  return {
    ref: buildRef({ section: sectionIndex, image: imageIndex }),
    binDataPath,
    width,
    height,
    format,
  }
}

function deriveBinDataPath(pic: XmlNode): string {
  const idRef = asString(pic['hp:binDataIDRef'])
  if (idRef) {
    return `BinData/${idRef}`
  }

  const id = asString(pic['hp:id'])
  if (id) {
    return `BinData/${id}`
  }

  return ''
}

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text']
    return typeof text === 'string' ? text : ''
  }

  return ''
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[]
  }
  if (value === undefined || value === null) {
    return []
  }
  return [value as T]
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
