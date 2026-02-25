import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import type JSZip from 'jszip'
import { type EditOperation, type FormatOptions, type XmlNode } from '@/shared/edit-types'
import { type ParsedRef, parseRef } from '@/shared/refs'
import type { HwpxArchive } from './loader'
import { PATHS, sectionPath } from './paths'

type SectionOperation = {
  op: EditOperation
  ref: ParsedRef
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
})

const builder = new XMLBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  format: false,
  suppressEmptyNode: false,
})

export async function mutateHwpxZip(zip: JSZip, archive: HwpxArchive, operations: EditOperation[]): Promise<void> {
  if (operations.length === 0) return

  const sectionOps = groupOperationsBySection(operations)
  let headerTree: XmlNode[] | null = null
  let headerChanged = false

  for (const [sectionIndex, ops] of sectionOps.entries()) {
    const sectionXml = await archive.getSectionXml(sectionIndex)
    const sectionTree = parseXml(sectionXml)

    for (const { op, ref } of ops) {
      if (op.type === 'addTable') {
        addTableToSection(sectionTree, op.rows, op.cols, op.data)
        continue
      }

      if (op.type === 'setText') {
        setTextInRef(sectionTree, ref, op.text)
        continue
      }

      if (op.type === 'setTableCell') {
        setTextInTableCell(sectionTree, ref, op.text)
        continue
      }

      if (op.type === 'addParagraph') {
        if (!headerTree) {
          headerTree = parseXml(await archive.getHeaderXml())
        }
        addParagraphToSection(sectionTree, headerTree, op.text, op.position, ref, op.format)
        if (op.format) headerChanged = true
        continue
      }

      if (op.type === 'setFormat') {
        if (!headerTree) {
          headerTree = parseXml(await archive.getHeaderXml())
        }

        if (op.start !== undefined && op.end !== undefined) {
          applyInlineFormat(sectionTree, headerTree, ref, op.format, op.start, op.end)
          headerChanged = true
          continue
        }

        const runNodes = findRunNodesForRef(sectionTree, ref)
        if (runNodes.length === 0) {
          throw new Error(`Run not found for reference: ${op.ref}`)
        }

        const newCharPrId = appendFormattedCharPr(headerTree, runNodes[0], op.format)
        for (const runNode of runNodes) {
          setAttr(runNode, 'charPrIDRef', String(newCharPrId), 'hp:charPrIDRef')
        }
        headerChanged = true
        continue
      }

      throw new Error(`Unsupported operation: ${(op as { type: string }).type}`)
    }

    zip.file(sectionPath(sectionIndex), buildXml(sectionTree))
  }

  if (headerChanged && headerTree) {
    zip.file(PATHS.HEADER_XML, buildXml(headerTree))
  }
}

function groupOperationsBySection(operations: EditOperation[]): Map<number, SectionOperation[]> {
  const grouped = new Map<number, SectionOperation[]>()

  for (const op of operations) {
    if (op.type === 'addTable') {
      const ref = parseRef(op.ref)
      const list = grouped.get(ref.section) ?? []
      list.push({ op, ref })
      grouped.set(ref.section, list)
      continue
    }

    const ref = parseRef(op.ref)
    const list = grouped.get(ref.section) ?? []
    list.push({ op, ref })
    grouped.set(ref.section, list)
  }

  return grouped
}

function setTextInRef(sectionTree: XmlNode[], ref: ParsedRef, text: string): void {
  if (ref.table !== undefined) {
    setTextInTableCell(sectionTree, ref, text)
    return
  }

  if (ref.textBox !== undefined) {
    if (ref.textBoxParagraph === undefined) {
      throw new Error(`setText requires a text box paragraph reference: s${ref.section}.tb${ref.textBox}`)
    }

    const paragraphNode = getTextBoxParagraphNode(sectionTree, ref.textBox, ref.textBoxParagraph)
    setParagraphText(paragraphNode, text)
    return
  }

  if (ref.paragraph === undefined) {
    throw new Error(`setText requires a paragraph or cell reference: s${ref.section}`)
  }

  const paragraphNode = getSectionParagraphNode(sectionTree, ref.paragraph)
  setParagraphText(paragraphNode, text)
}

function setTextInTableCell(sectionTree: XmlNode[], ref: ParsedRef, text: string): void {
  if (ref.table === undefined || ref.row === undefined || ref.cell === undefined) {
    throw new Error(`setTableCell requires a cell reference: s${ref.section}`)
  }

  const cellNode = getTableCellNode(sectionTree, ref.table, ref.row, ref.cell)
  const paragraphs = getCellParagraphNodes(cellNode)

  if (paragraphs.length === 0) {
    throw new Error(`Cell has no paragraph: s${ref.section}.t${ref.table}.r${ref.row}.c${ref.cell}`)
  }

  paragraphs.forEach((paragraph, index) => {
    setParagraphText(paragraph, index === 0 ? text : '')
  })
}

function addTableToSection(sectionTree: XmlNode[], rows: number, cols: number, data?: string[][]): void {
  const sectionRoot = getSectionRootNode(sectionTree)
  const elementName = getElementName(sectionRoot)
  const sectionChildren = getElementChildren(sectionRoot, elementName)

  const tableRows: XmlNode[] = Array.from({ length: rows }, (_, ri) => {
    const rowCells: XmlNode[] = Array.from({ length: cols }, (_, ci) => {
      const cellText = data?.[ri]?.[ci] ?? ''

      const cellAddr: XmlNode = {
        'hp:cellAddr': [],
        ':@': {
          'hp:colAddr': String(ci),
          'hp:rowAddr': String(ri),
        },
      }

      const cellSpan: XmlNode = {
        'hp:cellSpan': [],
        ':@': {
          'hp:colSpan': '1',
          'hp:rowSpan': '1',
        },
      }

      const textNode: XmlNode = {
        'hp:t': [{ '#text': cellText }],
      }

      const runNode: XmlNode = {
        'hp:run': [textNode],
        ':@': {
          'hp:charPrIDRef': '0',
        },
      }

      const paragraphNode: XmlNode = {
        'hp:p': [runNode],
        ':@': {
          'hp:id': '0',
          'hp:paraPrIDRef': '0',
          'hp:styleIDRef': '0',
        },
      }

      return {
        'hp:tc': [cellAddr, cellSpan, paragraphNode],
      }
    })

    return {
      'hp:tr': rowCells,
    }
  })

  const tableNode: XmlNode = {
    'hp:tbl': tableRows,
  }

  sectionChildren.push(tableNode)
}

function addParagraphToSection(
  sectionTree: XmlNode[],
  headerTree: XmlNode[],
  text: string,
  position: 'before' | 'after' | 'end',
  ref: ParsedRef,
  format?: FormatOptions,
): void {
  const sectionRoot = getSectionRootNode(sectionTree)
  const elementName = getElementName(sectionRoot)
  const sectionChildren = getElementChildren(sectionRoot, elementName)

  const textNode: XmlNode = { 'hp:t': [{ '#text': text }] }
  const runNode: XmlNode = {
    'hp:run': [textNode],
    ':@': { 'hp:charPrIDRef': '0' },
  }
  const paraNode: XmlNode = {
    'hp:p': [runNode],
    ':@': { 'hp:id': '0', 'hp:paraPrIDRef': '0', 'hp:styleIDRef': '0' },
  }

  if (format) {
    const newCharPrId = appendFormattedCharPr(headerTree, runNode, format)
    setAttr(runNode, 'charPrIDRef', String(newCharPrId), 'hp:charPrIDRef')
  }

  if (position === 'end') {
    sectionChildren.push(paraNode)
    return
  }

  if (ref.paragraph === undefined) {
    throw new Error(`addParagraph with position '${position}' requires a paragraph reference`)
  }

  let paragraphCount = -1
  let targetIndex = -1
  for (let i = 0; i < sectionChildren.length; i++) {
    if (hasElement(sectionChildren[i], 'hp:p')) {
      paragraphCount++
      if (paragraphCount === ref.paragraph) {
        targetIndex = i
        break
      }
    }
  }

  if (targetIndex === -1) {
    throw new Error(`Paragraph not found: index ${ref.paragraph}`)
  }

  const insertIndex = position === 'before' ? targetIndex : targetIndex + 1
  sectionChildren.splice(insertIndex, 0, paraNode)
}

function setParagraphText(paragraphNode: XmlNode, text: string): void {
  const runNodes = getRunNodesFromParagraph(paragraphNode)
  if (runNodes.length === 0) {
    throw new Error('Target paragraph has no runs')
  }

  runNodes.forEach((runNode, index) => {
    setRunText(runNode, index === 0 ? text : '')
  })
}

function setRunText(runNode: XmlNode, text: string): void {
  const runChildren = getElementChildren(runNode, 'hp:run')
  const textNode = runChildren.find((child) => hasElement(child, 'hp:t'))

  if (!textNode) {
    runChildren.push({ 'hp:t': [{ '#text': text }] })
    return
  }

  textNode['hp:t'] = [{ '#text': text }]
}

function applyInlineFormat(
  sectionTree: XmlNode[],
  headerTree: XmlNode[],
  ref: ParsedRef,
  format: FormatOptions,
  start: number,
  end: number,
): void {
  if (ref.paragraph === undefined) {
    throw new Error(`Inline format requires paragraph reference: s${ref.section}`)
  }

  const paragraphNode = getSectionParagraphNode(sectionTree, ref.paragraph)
  const runs = getRunNodesFromParagraph(paragraphNode)
  const totalLength = runs.reduce((sum, run) => sum + getRunText(run).length, 0)

  if (start < 0 || end > totalLength || start >= end) {
    throw new Error(`Offset out of range: start=${start}, end=${end}, length=${totalLength}`)
  }

  const newRuns: XmlNode[] = []
  let charOffset = 0

  for (const run of runs) {
    const text = getRunText(run)
    const runStart = charOffset
    const runEnd = charOffset + text.length

    if (runEnd <= start || runStart >= end) {
      newRuns.push(run)
    } else if (runStart >= start && runEnd <= end) {
      const formattedRun = deepCloneRun(run)
      const newCharPrId = appendFormattedCharPr(headerTree, formattedRun, format)
      setAttr(formattedRun, 'charPrIDRef', String(newCharPrId), 'hp:charPrIDRef')
      newRuns.push(formattedRun)
    } else {
      const overlapStart = Math.max(start, runStart) - runStart
      const overlapEnd = Math.min(end, runEnd) - runStart

      if (overlapStart > 0) {
        const beforeRun = deepCloneRun(run)
        setRunText(beforeRun, text.slice(0, overlapStart))
        newRuns.push(beforeRun)
      }

      const middleRun = deepCloneRun(run)
      setRunText(middleRun, text.slice(overlapStart, overlapEnd))
      const newCharPrId = appendFormattedCharPr(headerTree, middleRun, format)
      setAttr(middleRun, 'charPrIDRef', String(newCharPrId), 'hp:charPrIDRef')
      newRuns.push(middleRun)

      if (overlapEnd < text.length) {
        const afterRun = deepCloneRun(run)
        setRunText(afterRun, text.slice(overlapEnd))
        newRuns.push(afterRun)
      }
    }

    charOffset += text.length
  }

  replaceRunsInParagraph(paragraphNode, newRuns)
}

function getRunText(runNode: XmlNode): string {
  const runChildren = getElementChildren(runNode, 'hp:run')
  const textNode = runChildren.find((child) => hasElement(child, 'hp:t'))
  if (!textNode) {
    return ''
  }

  const textChildren = getElementChildren(textNode, 'hp:t')
  const textContent = textChildren.find((child) => Object.hasOwn(child, '#text'))
  return textContent ? String(textContent['#text']) : ''
}

function deepCloneRun(runNode: XmlNode): XmlNode {
  return deepClone(runNode)
}

function replaceRunsInParagraph(paragraphNode: XmlNode, newRuns: XmlNode[]): void {
  const children = getElementChildren(paragraphNode, 'hp:p')
  const runIndices: number[] = []

  for (let i = 0; i < children.length; i++) {
    if (hasElement(children[i], 'hp:run')) {
      runIndices.push(i)
    }
  }

  for (let i = runIndices.length - 1; i >= 0; i--) {
    children.splice(runIndices[i], 1)
  }

  const insertAt = runIndices[0] ?? children.length
  children.splice(insertAt, 0, ...newRuns)
}

function findRunNodesForRef(sectionTree: XmlNode[], ref: ParsedRef): XmlNode[] {
  if (ref.table !== undefined) {
    if (ref.row === undefined || ref.cell === undefined) {
      throw new Error(`Table reference must include row/cell: s${ref.section}.t${ref.table}`)
    }

    const cellNode = getTableCellNode(sectionTree, ref.table, ref.row, ref.cell)
    const paragraphs = getCellParagraphNodes(cellNode)
    const targetParagraphs =
      ref.cellParagraph !== undefined
        ? [paragraphs[ref.cellParagraph]].filter((p): p is XmlNode => Boolean(p))
        : paragraphs

    if (targetParagraphs.length === 0) {
      throw new Error(`Cell paragraph not found: s${ref.section}.t${ref.table}.r${ref.row}.c${ref.cell}`)
    }

    const runs = targetParagraphs.flatMap((paragraph) => getRunNodesFromParagraph(paragraph))
    return selectRunsByIndex(runs, ref)
  }

  if (ref.paragraph === undefined) {
    throw new Error(`setFormat requires paragraph or cell reference: s${ref.section}`)
  }

  const paragraphNode = getSectionParagraphNode(sectionTree, ref.paragraph)
  const runs = getRunNodesFromParagraph(paragraphNode)
  return selectRunsByIndex(runs, ref)
}

function selectRunsByIndex(runs: XmlNode[], ref: ParsedRef): XmlNode[] {
  if (ref.run === undefined) {
    return runs
  }

  const run = runs[ref.run]
  return run ? [run] : []
}

function appendFormattedCharPr(headerTree: XmlNode[], runNode: XmlNode, format: FormatOptions): number {
  const charPropertiesNode = getCharPropertiesNode(headerTree)
  const charPrNodes = getChildElements(getElementChildren(charPropertiesNode, 'hh:charProperties'), 'hh:charPr')

  const sourceId = parseIntStrict(getAttr(runNode, 'charPrIDRef') ?? '0', 'charPrIDRef')
  const sourceNode = charPrNodes.find(
    (charPr) => parseIntStrict(getAttr(charPr, 'id') ?? '0', 'charPr id') === sourceId,
  )

  if (!sourceNode) {
    throw new Error(`charPr not found for id: ${sourceId}`)
  }

  const cloned = deepClone(sourceNode)
  const newId = getNextId(charPrNodes, 'id')

  setAttr(cloned, 'id', String(newId), 'hh:id')
  applyFormat(cloned, format, headerTree)

  getElementChildren(charPropertiesNode, 'hh:charProperties').push(cloned)
  return newId
}

function applyFormat(charPrNode: XmlNode, format: FormatOptions, headerTree: XmlNode[]): void {
  if (format.bold !== undefined) {
    setAttr(charPrNode, 'fontBold', format.bold ? '1' : '0', 'hh:fontBold')
  }

  if (format.italic !== undefined) {
    setAttr(charPrNode, 'fontItalic', format.italic ? '1' : '0', 'hh:fontItalic')
  }

  if (format.underline !== undefined) {
    setAttr(charPrNode, 'underline', format.underline ? '1' : '0', 'hh:underline')
  }

  if (format.fontSize !== undefined) {
    setAttr(charPrNode, 'height', String(Math.round(format.fontSize * 100)), 'hh:height')
  }

  if (format.color !== undefined) {
    setAttr(charPrNode, 'color', String(hexToColorInt(format.color)), 'hh:color')
  }

  if (format.fontName !== undefined) {
    const fontId = resolveFontId(headerTree, format.fontName)
    setAttr(charPrNode, 'fontRef', String(fontId), 'hh:fontRef')
  }
}

function resolveFontId(headerTree: XmlNode[], fontName: string): number {
  const fontFacesNode = getFontFacesNode(headerTree)
  const fontNodes = getChildElements(getElementChildren(fontFacesNode, 'hh:fontfaces'), 'hh:fontface')

  const existing = fontNodes.find((fontNode) => getAttr(fontNode, 'face') === fontName)
  if (existing) {
    return parseIntStrict(getAttr(existing, 'id') ?? '0', 'font id')
  }

  const newId = getNextId(fontNodes, 'id')
  const newFont: XmlNode = {
    'hh:fontface': [],
    ':@': {
      'hh:id': String(newId),
      'hh:face': fontName,
    },
  }

  getElementChildren(fontFacesNode, 'hh:fontfaces').push(newFont)
  return newId
}

function getSectionParagraphNode(sectionTree: XmlNode[], paragraphIndex: number): XmlNode {
  const sectionRoot = getSectionRootNode(sectionTree)
  const sectionChildren = getElementChildren(sectionRoot, getElementName(sectionRoot))
  const paragraphs = getChildElements(sectionChildren, 'hp:p')
  const paragraph = paragraphs[paragraphIndex]

  if (!paragraph) {
    throw new Error(`Paragraph not found: index ${paragraphIndex}`)
  }

  return paragraph
}

function getTableCellNode(sectionTree: XmlNode[], tableIndex: number, rowIndex: number, cellIndex: number): XmlNode {
  const sectionRoot = getSectionRootNode(sectionTree)
  const sectionChildren = getElementChildren(sectionRoot, getElementName(sectionRoot))
  const tables = getChildElements(sectionChildren, 'hp:tbl')
  const table = tables[tableIndex]

  if (!table) {
    throw new Error(`Table not found: index ${tableIndex}`)
  }

  const rows = getChildElements(getElementChildren(table, 'hp:tbl'), 'hp:tr')
  const row = rows[rowIndex]
  if (!row) {
    throw new Error(`Table row not found: index ${rowIndex}`)
  }

  const cells = getChildElements(getElementChildren(row, 'hp:tr'), 'hp:tc')
  const cell = cells[cellIndex]
  if (!cell) {
    throw new Error(`Table cell not found: index ${cellIndex}`)
  }

  return cell
}

function getTextBoxParagraphNode(sectionTree: XmlNode[], textBoxIndex: number, paragraphIndex: number): XmlNode {
  const rects = getTextBoxRectNodes(sectionTree)
  const rect = rects[textBoxIndex]
  if (!rect) {
    throw new Error(`Text box not found: index ${textBoxIndex}`)
  }

  const drawText = getChildElements(getElementChildren(rect, 'hp:rect'), 'hp:drawText')[0]
  if (!drawText) {
    throw new Error(`Text box has no hp:drawText: index ${textBoxIndex}`)
  }

  const subList = getChildElements(getElementChildren(drawText, 'hp:drawText'), 'hp:subList')[0]
  if (!subList) {
    throw new Error(`Text box has no hp:subList: index ${textBoxIndex}`)
  }

  const paragraphs = getChildElements(getElementChildren(subList, 'hp:subList'), 'hp:p')
  const paragraph = paragraphs[paragraphIndex]
  if (!paragraph) {
    throw new Error(`Text box paragraph not found: tb${textBoxIndex}.p${paragraphIndex}`)
  }

  return paragraph
}

function getTextBoxRectNodes(sectionTree: XmlNode[]): XmlNode[] {
  const sectionRoot = getSectionRootNode(sectionTree)
  const sectionChildren = getElementChildren(sectionRoot, getElementName(sectionRoot))
  const sectionRects = getChildElements(sectionChildren, 'hp:rect')
  const sectionParagraphs = getChildElements(sectionChildren, 'hp:p')
  const inlineRects = sectionParagraphs.flatMap((paragraph) =>
    getChildElements(getElementChildren(paragraph, 'hp:p'), 'hp:rect'),
  )

  return [...sectionRects, ...inlineRects]
}

function getCellParagraphNodes(cellNode: XmlNode): XmlNode[] {
  return getChildElements(getElementChildren(cellNode, 'hp:tc'), 'hp:p')
}

function getRunNodesFromParagraph(paragraphNode: XmlNode): XmlNode[] {
  return getChildElements(getElementChildren(paragraphNode, 'hp:p'), 'hp:run')
}

function getSectionRootNode(tree: XmlNode[]): XmlNode {
  const sectionRoot = tree.find((node) => hasElement(node, 'hs:sec') || hasElement(node, 'hs:section'))
  if (!sectionRoot) {
    throw new Error('Section root not found')
  }
  return sectionRoot
}

function getCharPropertiesNode(headerTree: XmlNode[]): XmlNode {
  const refListNode = getRefListNode(headerTree)
  const charPropertiesNode = getChildElements(getElementChildren(refListNode, 'hh:refList'), 'hh:charProperties')[0]
  if (!charPropertiesNode) {
    throw new Error('hh:charProperties not found in header.xml')
  }
  return charPropertiesNode
}

function getFontFacesNode(headerTree: XmlNode[]): XmlNode {
  const refListNode = getRefListNode(headerTree)
  const fontFacesNode = getChildElements(getElementChildren(refListNode, 'hh:refList'), 'hh:fontfaces')[0]
  if (!fontFacesNode) {
    throw new Error('hh:fontfaces not found in header.xml')
  }
  return fontFacesNode
}

function getRefListNode(headerTree: XmlNode[]): XmlNode {
  const headNode = headerTree.find((node) => hasElement(node, 'hh:head'))
  if (!headNode) {
    throw new Error('hh:head not found in header.xml')
  }

  const refListNode = getChildElements(getElementChildren(headNode, 'hh:head'), 'hh:refList')[0]
  if (!refListNode) {
    throw new Error('hh:refList not found in header.xml')
  }
  return refListNode
}

function getElementName(node: XmlNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ':@') {
      return key
    }
  }
  throw new Error('Invalid XML node: missing element name')
}

function getElementChildren(node: XmlNode, elementName: string): XmlNode[] {
  const value = node[elementName]
  if (!Array.isArray(value)) {
    throw new Error(`Invalid XML node shape for element: ${elementName}`)
  }
  return value as XmlNode[]
}

function getChildElements(children: XmlNode[], elementName: string): XmlNode[] {
  return children.filter((child) => hasElement(child, elementName))
}

function hasElement(node: XmlNode, elementName: string): boolean {
  return Object.hasOwn(node, elementName)
}

function getAttr(node: XmlNode, baseName: string): string | undefined {
  const attrs = node[':@']
  if (!attrs || typeof attrs !== 'object') {
    return undefined
  }

  for (const [key, value] of Object.entries(attrs)) {
    if (key === baseName || key.endsWith(`:${baseName}`)) {
      return typeof value === 'string' ? value : undefined
    }
  }

  return undefined
}

function setAttr(node: XmlNode, baseName: string, value: string, preferredKey: string): void {
  const attrs = getOrCreateAttrs(node)
  const existingKey = Object.keys(attrs).find((key) => key === baseName || key.endsWith(`:${baseName}`))
  attrs[existingKey ?? preferredKey] = value
}

function getOrCreateAttrs(node: XmlNode): XmlNode {
  const attrs = node[':@']
  if (attrs && typeof attrs === 'object') {
    return attrs as XmlNode
  }

  const nextAttrs: XmlNode = {}
  node[':@'] = nextAttrs
  return nextAttrs
}

function getNextId(nodes: XmlNode[], attrName: string): number {
  let max = -1

  for (const node of nodes) {
    const raw = getAttr(node, attrName)
    if (!raw) {
      continue
    }
    const value = Number.parseInt(raw, 10)
    if (!Number.isNaN(value) && value > max) {
      max = value
    }
  }

  return max + 1
}

function parseIntStrict(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`)
  }
  return parsed
}

function hexToColorInt(hexColor: string): number {
  const normalized = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Invalid color value: ${hexColor}`)
  }
  return Number.parseInt(normalized, 16)
}

export function parseXml(xml: string): XmlNode[] {
  return parser.parse(xml) as XmlNode[]
}

export function buildXml(tree: XmlNode[]): string {
  return builder.build(tree)
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
