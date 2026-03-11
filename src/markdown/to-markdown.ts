import type {
  CharShape,
  DocumentHeader,
  HwpDocument,
  Paragraph,
  Section,
  Table,
  TableCell,
  TableRow,
} from '@/types'
import { getHeadingLevel } from './heading-styles'

export function hwpToMarkdown(doc: HwpDocument): string {
  const sections = doc.sections.map((section) => convertSection(section, doc.header))
  return sections.join('\n\n---\n\n')
}

function convertSection(section: Section, header: DocumentHeader): string {
  const blocks: string[] = []

  for (const paragraph of section.paragraphs) {
    blocks.push(convertParagraph(paragraph, header))
  }

  for (const image of section.images) {
    blocks.push(`![](${image.binDataPath})`)
  }

  for (const textBox of section.textBoxes) {
    for (const paragraph of textBox.paragraphs) {
      blocks.push(convertParagraph(paragraph, header))
    }
  }

  for (const table of section.tables) {
    blocks.push(convertTable(table, header))
  }

  return blocks.join('\n\n')
}

function convertParagraph(paragraph: Paragraph, header: DocumentHeader): string {
  const text = convertParagraphText(paragraph, header)
  if (text.length === 0) {
    return ''
  }

  const headingLevel = getHeadingLevel(
    paragraph,
    header.styles,
    header.paraShapes
  )
  if (headingLevel === null) {
    return text
  }

  const normalizedHeadingLevel = Math.max(1, Math.min(headingLevel, 6))
  return `${'#'.repeat(normalizedHeadingLevel)} ${text}`
}

function convertParagraphText(paragraph: Paragraph, header: DocumentHeader): string {
  return paragraph.runs
    .map((run) => formatRunText(run.text, resolveCharShape(run.charShapeRef, header)))
    .filter((text) => text.length > 0)
    .join('')
}

function resolveCharShape(
  charShapeRef: number,
  header: DocumentHeader
): CharShape | undefined {
  return (
    header.charShapes.find((charShape) => charShape.id === charShapeRef) ??
    header.charShapes[charShapeRef]
  )
}

function formatRunText(text: string, charShape?: CharShape): string {
  if (text.length === 0) {
    return ''
  }

  if (!charShape) {
    return text
  }

  if (charShape.bold && charShape.italic) {
    return `***${text}***`
  }

  if (charShape.bold) {
    return `**${text}**`
  }

  if (charShape.italic) {
    return `*${text}*`
  }

  return text
}

function convertTable(table: Table, header: DocumentHeader): string {
  if (table.rows.length === 0) {
    return ''
  }

  const headerRow = table.rows[0]
  const lines = [rowToMarkdown(headerRow, header)]
  lines.push(separatorRow(headerRow))

  for (const row of table.rows.slice(1)) {
    lines.push(rowToMarkdown(row, header))
  }

  return lines.join('\n')
}

function rowToMarkdown(row: TableRow, header: DocumentHeader): string {
  const content = row.cells.map((cell) => convertCell(cell, header)).join(' | ')
  return `| ${content} |`
}

function separatorRow(headerRow: TableRow): string {
  const separators = headerRow.cells.map(() => '---').join('|')
  return `|${separators}|`
}

function convertCell(cell: TableCell, header: DocumentHeader): string {
  return cell.paragraphs
    .map((paragraph) => convertParagraphText(paragraph, header))
    .filter((text) => text.length > 0)
    .join(' ')
}
