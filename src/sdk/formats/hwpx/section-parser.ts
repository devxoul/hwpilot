import { XMLParser } from 'fast-xml-parser'

import { buildRef } from '@/sdk/refs'
import type { Image, Paragraph, Run, Section, Table, TableCell, TableRow, TextBox } from '@/sdk/types'

import type { HwpxArchive } from './loader'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  trimValues: false,
  isArray: (name) => ['hp:p', 'hp:run', 'hp:tbl', 'hp:tr', 'hp:tc', 'hp:pic', 'hp:rect'].includes(name),
})

type XmlNode = Record<string, unknown>

export function parseSection(xml: string, sectionIndex: number): Section {
  const parsed = parser.parse(xml) as Record<string, unknown>
  const sec = (parsed['hs:sec'] ?? {}) as XmlNode

  const rawParagraphs = asArray<XmlNode>(sec['hp:p'])
  const rawTables = collectFlowChildren(sec, rawParagraphs, 'hp:tbl')
  const rawPics = collectFlowChildren(sec, rawParagraphs, 'hp:pic')
  const rawRects = collectFlowChildren(sec, rawParagraphs, 'hp:rect')

  const paragraphs = rawParagraphs.map((paragraph, paragraphIndex) =>
    parseParagraph(paragraph, {
      section: sectionIndex,
      paragraph: paragraphIndex,
    }),
  )

  const tables = rawTables.map((table, tableIndex) => parseTable(table, sectionIndex, tableIndex))
  const images = rawPics.map((pic, imageIndex) => parseImage(pic, sectionIndex, imageIndex))
  const textBoxes = rawRects
    .map((rect, textBoxIndex) => parseTextBox(rect, sectionIndex, textBoxIndex))
    .filter((textBox): textBox is TextBox => textBox !== null)

  return {
    paragraphs,
    tables,
    images,
    textBoxes,
  }
}

/**
 * Collect element instances of `tag` that appear directly in the section flow,
 * in document order. The flow is: section-level direct children, plus any
 * children nested inside `hp:p` (paragraph-direct) or `hp:p > hp:run`
 * (run-direct) wrappers. Real-world HWPX produced by Hancom typically wraps
 * tables/images inside paragraph runs even when conceptually they are
 * top-level objects, so a section-only collector misses them entirely.
 *
 * Traversal is intentionally narrow: we do not recurse into `hp:tc` (table
 * cells), `hp:drawText` (text box bodies), or other subtrees, otherwise nested
 * tables-in-cells would surface as top-level tables and break ref semantics.
 */
function collectFlowChildren(sec: XmlNode, paragraphs: XmlNode[], tag: string): XmlNode[] {
  const sectionDirect = asArray<XmlNode>(sec[tag])
  const fromParagraphs = paragraphs.flatMap((paragraph) => {
    const paragraphDirect = asArray<XmlNode>(paragraph[tag])
    const runDirect = asArray<XmlNode>(paragraph['hp:run']).flatMap((run) => asArray<XmlNode>(run[tag]))
    return [...paragraphDirect, ...runDirect]
  })
  return [...sectionDirect, ...fromParagraphs]
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
    textBox?: number
    textBoxParagraph?: number
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

function parseTextBox(rect: XmlNode, sectionIndex: number, textBoxIndex: number): TextBox | null {
  const drawText = rect['hp:drawText']
  if (!drawText || typeof drawText !== 'object') {
    return null
  }

  const subList = (drawText as XmlNode)['hp:subList']
  if (!subList || typeof subList !== 'object') {
    return null
  }

  const paragraphs = asArray<XmlNode>((subList as XmlNode)['hp:p']).map((paragraph, paragraphIndex) =>
    parseParagraph(paragraph, {
      section: sectionIndex,
      textBox: textBoxIndex,
      textBoxParagraph: paragraphIndex,
    }),
  )

  return {
    ref: buildRef({ section: sectionIndex, textBox: textBoxIndex }),
    paragraphs,
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
  const rawParagraphs = getCellParagraphs(cell)

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

/**
 * Real-world HWPX wraps cell paragraphs in `<hp:subList>` (matching the spec
 * for table-cell text containers), but minimal/synthetic HWPX often nests
 * paragraphs directly under `<hp:tc>`. Accept both shapes.
 */
function getCellParagraphs(cell: XmlNode): XmlNode[] {
  const direct = asArray<XmlNode>(cell['hp:p'])
  if (direct.length > 0) {
    return direct
  }
  const subList = cell['hp:subList']
  if (subList && typeof subList === 'object') {
    return asArray<XmlNode>((subList as XmlNode)['hp:p'])
  }
  return []
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

  if (typeof value === 'number') {
    return String(value)
  }

  if (value && typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text']
    return typeof text === 'string' ? text : typeof text === 'number' ? String(text) : ''
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
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}
