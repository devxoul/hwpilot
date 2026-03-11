import type {
  Blockquote,
  Code,
  Delete,
  List,
  ListItem,
  PhrasingContent,
  Root,
  Table as MdTable,
  TableCell as MdTableCell,
  TableRow as MdTableRow,
} from 'mdast'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import {
  type DocumentHeader,
  type FontFace,
  type HwpDocument,
  type Image,
  type Paragraph,
  type ParaShape,
  type Run,
  type Section,
  type Style,
  type Table,
  type TableCell,
  type TableRow,
} from '@/types'
import { CharShapeRegistry } from './charshape-registry'
import { createHeadingInfrastructure } from './heading-styles'

type InlineFlags = {
  bold?: boolean
  italic?: boolean
}

type SectionAccumulator = {
  section: Section
  paragraphCount: number
  tableCount: number
  imageCount: number
}

export function markdownToHwp(md: string): HwpDocument {
  const tree = remark().use(remarkGfm).parse(md) as Root
  const charShapeRegistry = new CharShapeRegistry(0, 1000)

  const fonts: FontFace[] = [
    { id: 0, name: '맑은 고딕' },
    { id: 1, name: 'Courier New' },
  ]

  const headingInfra = createHeadingInfrastructure(0, 0, 0)
  const paraShapes: ParaShape[] = [{ id: 0, align: 'left' }, ...headingInfra.paraShapes]
  const styles: Style[] = [
    { id: 0, name: '본문', charShapeRef: 0, paraShapeRef: 0, type: 'PARA' },
    ...headingInfra.styles,
  ]

  const sections: Section[] = []
  let sectionIndex = 0
  let current = createSectionAccumulator()

  const pushCurrentSection = (): void => {
    sections.push(current.section)
  }

  const startNextSection = (): void => {
    sectionIndex += 1
    current = createSectionAccumulator()
  }

  for (const node of tree.children) {
    switch (node.type) {
      case 'thematicBreak': {
        pushCurrentSection()
        startNextSection()
        break
      }
      case 'paragraph': {
        const runs: Run[] = []
        for (const child of node.children) {
          appendRunsFromPhrasing(child, runs, charShapeRegistry, current, sectionIndex, {})
        }

        if (runs.length > 0) {
          current.section.paragraphs.push(
            createParagraph(sectionIndex, current.paragraphCount, runs, 0, 0),
          )
          current.paragraphCount += 1
        }
        break
      }
      case 'heading': {
        const depth = Math.max(1, Math.min(6, node.depth))
        const text = collectText(node)
        const runs: Run[] = [{ text, charShapeRef: 0 }]

        current.section.paragraphs.push(
          createParagraph(sectionIndex, current.paragraphCount, runs, depth, depth),
        )
        current.paragraphCount += 1
        break
      }
      case 'table': {
        const table = createTableFromMdast(node, sectionIndex, current.tableCount)
        current.section.tables.push(table)
        current.tableCount += 1
        break
      }
      case 'list': {
        appendListParagraphs(node, sectionIndex, current, charShapeRegistry, 0)
        break
      }
      case 'code': {
        appendCodeParagraphs(node, sectionIndex, current, charShapeRegistry)
        break
      }
      case 'blockquote': {
        appendBlockquoteParagraphs(node, sectionIndex, current, charShapeRegistry)
        break
      }
      case 'image': {
        appendImage(node.url, sectionIndex, current)
        break
      }
      default:
        break
    }
  }

  pushCurrentSection()

  const header: DocumentHeader = {
    fonts,
    charShapes: charShapeRegistry.getCharShapes(),
    paraShapes,
    styles,
  }

  return {
    format: 'hwp',
    sections,
    header,
  }
}

function createSectionAccumulator(): SectionAccumulator {
  return {
    section: {
      paragraphs: [],
      tables: [],
      images: [],
      textBoxes: [],
    },
    paragraphCount: 0,
    tableCount: 0,
    imageCount: 0,
  }
}

function createParagraph(
  sectionIndex: number,
  paragraphIndex: number,
  runs: Run[],
  paraShapeRef: number,
  styleRef: number,
): Paragraph {
  return {
    ref: `s${sectionIndex}.p${paragraphIndex}`,
    runs,
    paraShapeRef,
    styleRef,
  }
}

function appendRunsFromPhrasing(
  node: PhrasingContent,
  runs: Run[],
  registry: CharShapeRegistry,
  current: SectionAccumulator,
  sectionIndex: number,
  flags: InlineFlags,
): void {
  switch (node.type) {
    case 'text': {
      const charShapeRef = registry.getRef({
        bold: flags.bold,
        italic: flags.italic,
      })
      runs.push({ text: node.value, charShapeRef })
      break
    }
    case 'strong': {
      for (const child of node.children) {
        appendRunsFromPhrasing(child, runs, registry, current, sectionIndex, {
          ...flags,
          bold: true,
        })
      }
      break
    }
    case 'emphasis': {
      for (const child of node.children) {
        appendRunsFromPhrasing(child, runs, registry, current, sectionIndex, {
          ...flags,
          italic: true,
        })
      }
      break
    }
    case 'delete': {
      for (const child of node.children) {
        appendRunsFromDelete(child, runs, registry, current, sectionIndex, flags)
      }
      break
    }
    case 'inlineCode': {
      const charShapeRef = registry.getRef({
        bold: flags.bold,
        italic: flags.italic,
        fontRef: 1,
      })
      runs.push({ text: node.value, charShapeRef })
      break
    }
    case 'link': {
      const linkText = collectText(node)
      const charShapeRef = registry.getRef({
        bold: flags.bold,
        italic: flags.italic,
      })
      runs.push({ text: `${linkText} (${node.url})`, charShapeRef })
      break
    }
    case 'image': {
      appendImage(node.url, sectionIndex, current)
      break
    }
    default:
      break
  }
}

function appendRunsFromDelete(
  node: Delete['children'][number],
  runs: Run[],
  registry: CharShapeRegistry,
  current: SectionAccumulator,
  sectionIndex: number,
  flags: InlineFlags,
): void {
  if (node.type === 'text') {
    const charShapeRef = registry.getRef({
      bold: flags.bold,
      italic: flags.italic,
    })
    runs.push({ text: node.value, charShapeRef })
    return
  }

  if (node.type === 'emphasis' || node.type === 'strong' || node.type === 'inlineCode' || node.type === 'link' || node.type === 'image') {
    appendRunsFromPhrasing(node, runs, registry, current, sectionIndex, flags)
  }
}

function appendImage(url: string, sectionIndex: number, current: SectionAccumulator): void {
  const image: Image = {
    ref: `s${sectionIndex}.img${current.imageCount}`,
    binDataPath: url,
    width: 0,
    height: 0,
    format: inferImageFormat(url),
  }

  current.section.images.push(image)
  current.imageCount += 1
}

function inferImageFormat(url: string): string {
  const cleanUrl = url.split('#')[0].split('?')[0]
  const dotIndex = cleanUrl.lastIndexOf('.')
  if (dotIndex < 0 || dotIndex === cleanUrl.length - 1) {
    return ''
  }

  return cleanUrl.slice(dotIndex + 1).toLowerCase()
}

function createTableFromMdast(node: MdTable, sectionIndex: number, tableIndex: number): Table {
  const rows: TableRow[] = node.children.map((row, rowIndex) =>
    createTableRowFromMdast(row, sectionIndex, tableIndex, rowIndex),
  )

  return {
    ref: `s${sectionIndex}.t${tableIndex}`,
    rows,
  }
}

function createTableRowFromMdast(
  row: MdTableRow,
  sectionIndex: number,
  tableIndex: number,
  rowIndex: number,
): TableRow {
  const cells: TableCell[] = row.children.map((cell, cellIndex) =>
    createTableCellFromMdast(cell, sectionIndex, tableIndex, rowIndex, cellIndex),
  )

  return { cells }
}

function createTableCellFromMdast(
  cell: MdTableCell,
  sectionIndex: number,
  tableIndex: number,
  rowIndex: number,
  cellIndex: number,
): TableCell {
  const text = collectText(cell)
  return {
    ref: `s${sectionIndex}.t${tableIndex}.r${rowIndex}.c${cellIndex}`,
    paragraphs: [
      {
        ref: `s${sectionIndex}.p0`,
        runs: [{ text, charShapeRef: 0 }],
        paraShapeRef: 0,
        styleRef: 0,
      },
    ],
    colSpan: 1,
    rowSpan: 1,
  }
}

function appendListParagraphs(
  list: List,
  sectionIndex: number,
  current: SectionAccumulator,
  registry: CharShapeRegistry,
  level: number,
): void {
  list.children.forEach((item, itemIndex) => {
    appendListItemParagraph(item, list, itemIndex, sectionIndex, current, registry, level)
  })
}

function appendListItemParagraph(
  item: ListItem,
  list: List,
  itemIndex: number,
  sectionIndex: number,
  current: SectionAccumulator,
  registry: CharShapeRegistry,
  level: number,
): void {
  const indentPrefix = '  '.repeat(level)
  const marker = list.ordered ? `${itemIndex + 1}. ` : '• '
  const contentNodes = item.children.filter((child) => child.type !== 'list')
  const itemText = contentNodes.map((child) => collectText(child)).join(' ').trim()

  if (itemText.length > 0) {
    const charShapeRef = registry.getRef()
    const paragraph = createParagraph(
      sectionIndex,
      current.paragraphCount,
      [{ text: `${indentPrefix}${marker}${itemText}`, charShapeRef }],
      0,
      0,
    )
    current.section.paragraphs.push(paragraph)
    current.paragraphCount += 1
  }

  for (const child of item.children) {
    if (child.type === 'list') {
      appendListParagraphs(child, sectionIndex, current, registry, level + 1)
    }
  }
}

function appendCodeParagraphs(
  code: Code,
  sectionIndex: number,
  current: SectionAccumulator,
  registry: CharShapeRegistry,
): void {
  const codeShapeRef = registry.getRef({ fontRef: 1 })
  const lines = code.value.split('\n')
  for (const line of lines) {
    const paragraph = createParagraph(
      sectionIndex,
      current.paragraphCount,
      [{ text: line, charShapeRef: codeShapeRef }],
      0,
      0,
    )
    current.section.paragraphs.push(paragraph)
    current.paragraphCount += 1
  }
}

function appendBlockquoteParagraphs(
  blockquote: Blockquote,
  sectionIndex: number,
  current: SectionAccumulator,
  registry: CharShapeRegistry,
): void {
  for (const child of blockquote.children) {
    if (child.type === 'paragraph') {
      const text = collectText(child)
      const charShapeRef = registry.getRef()
      const paragraph = createParagraph(
        sectionIndex,
        current.paragraphCount,
        [{ text: `> ${text}`, charShapeRef }],
        0,
        0,
      )
      current.section.paragraphs.push(paragraph)
      current.paragraphCount += 1
    }
  }
}

function collectText(node: any): string {
  switch (node.type) {
    case 'text':
      return node.value ?? ''
    case 'inlineCode':
      return node.value ?? ''
    case 'image':
      return node.alt ?? ''
    default: {
      const childContainer = node as { children?: Array<any> }
      if (!childContainer.children) {
        return ''
      }

      let text = ''
      for (const child of childContainer.children) {
        if (child.type === 'text') {
          text += child.value ?? ''
        } else if (child.type === 'inlineCode') {
          text += child.value ?? ''
        } else if (child.type === 'image') {
          text += child.alt ?? ''
        } else if ('children' in child) {
          text += collectText(child)
        }
      }
      return text
    }
  }
}
