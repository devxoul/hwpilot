import { readFile, writeFile } from 'node:fs/promises'
import CFB from 'cfb'
import { type EditOperation, type FormatOptions } from '@/shared/edit-types'
import { parseRef } from '@/shared/refs'
import { iterateRecords } from './record-parser'
import { buildRecord, replaceRecordData } from './record-serializer'
import { compressStream, decompressStream, getCompressionFlag } from './stream-util'
import { TAG } from './tag-ids'

type SectionTextOperation = {
  type: 'setText'
  paragraph: number
  text: string
  ref: string
}

type SectionTableCellOperation = {
  type: 'setTableCell'
  table: number
  row: number
  cell: number
  text: string
  ref: string
}

type SectionFormatOperation = {
  type: 'setFormat'
  paragraph: number
  format: FormatOptions
  ref: string
}

type SectionOperation = SectionTextOperation | SectionTableCellOperation | SectionFormatOperation

export async function editHwp(filePath: string, operations: EditOperation[]): Promise<void> {
  if (operations.length === 0) {
    return
  }

  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const fileHeader = getEntryBuffer(cfb, '/FileHeader')
  const compressed = getCompressionFlag(fileHeader)
  const operationsBySection = groupOperationsBySection(operations)

  for (const [sectionIndex, sectionOperations] of operationsBySection.entries()) {
    const streamPath = `/BodyText/Section${sectionIndex}`
    let stream = getEntryBuffer(cfb, streamPath)
    if (compressed) {
      stream = decompressStream(stream)
    }

    for (const operation of sectionOperations) {
      if (operation.type === 'setText') {
        stream = patchParagraphText(stream, operation)
        continue
      }

      if (operation.type === 'setFormat') {
        CFB.utils.cfb_add(cfb, streamPath, compressed ? compressStream(stream) : stream)
        applySetFormat(cfb, sectionIndex, operation.paragraph, operation.format, compressed, operation.ref)
        stream = getEntryBuffer(cfb, streamPath)
        if (compressed) {
          stream = decompressStream(stream)
        }
        continue
      }

      stream = patchTableCellText(stream, operation.table, operation.row, operation.cell, operation.text, operation.ref)
    }

    CFB.utils.cfb_add(cfb, streamPath, compressed ? compressStream(stream) : stream)
  }

  await writeFile(filePath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
}

function groupOperationsBySection(operations: EditOperation[]): Map<number, SectionOperation[]> {
  const grouped = new Map<number, SectionOperation[]>()

  for (const operation of operations) {
    if (operation.type === 'setText') {
      const ref = parseRef(operation.ref)
      if (ref.paragraph === undefined) {
        throw new Error(`setText requires paragraph reference: ${operation.ref}`)
      }

      const sectionOperations = grouped.get(ref.section) ?? []
      sectionOperations.push({ type: 'setText', paragraph: ref.paragraph, text: operation.text, ref: operation.ref })
      grouped.set(ref.section, sectionOperations)
      continue
    }

    if (operation.type === 'setTableCell') {
      const ref = parseRef(operation.ref)
      if (ref.table === undefined || ref.row === undefined || ref.cell === undefined) {
        throw new Error(`setTableCell requires table cell reference: ${operation.ref}`)
      }

      const sectionOperations = grouped.get(ref.section) ?? []
      sectionOperations.push({
        type: 'setTableCell',
        table: ref.table,
        row: ref.row,
        cell: ref.cell,
        text: operation.text,
        ref: operation.ref,
      })
      grouped.set(ref.section, sectionOperations)
      continue
    }

    if (operation.type === 'setFormat') {
      const ref = parseRef(operation.ref)
      if (ref.paragraph === undefined) {
        throw new Error(`setFormat requires paragraph reference: ${operation.ref}`)
      }

      const sectionOperations = grouped.get(ref.section) ?? []
      sectionOperations.push({
        type: 'setFormat',
        paragraph: ref.paragraph,
        format: operation.format,
        ref: operation.ref,
      })
      grouped.set(ref.section, sectionOperations)
      continue
    }

    throw new Error('Unsupported HWP edit operation')
  }

  return grouped
}

function patchParagraphText(stream: Buffer, operation: SectionTextOperation): Buffer {
  let paragraphIndex = -1
  let waitingForTargetText = false

  for (const { header, data, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      paragraphIndex += 1
      waitingForTargetText = paragraphIndex === operation.paragraph
      continue
    }

    if (waitingForTargetText && header.tagId === TAG.PARA_TEXT) {
      const patchedData = buildPatchedParaText(data, operation.text)
      return replaceRecordData(stream, offset, patchedData)
    }
  }

  throw new Error(`Paragraph not found for reference: ${operation.ref}`)
}

function patchTableCellText(
  stream: Buffer,
  tableIndex: number,
  rowIndex: number,
  colIndex: number,
  text: string,
  ref: string,
): Buffer {
  let tableCursor = -1
  let tableFound = false
  let tableLevel: number | undefined
  let colCount: number | undefined
  let targetCellIndex: number | undefined
  let cellCursor = -1
  let insideTargetCell = false

  for (const { header, data, offset } of iterateRecords(stream)) {
    if (
      header.tagId === TAG.CTRL_HEADER &&
      header.level > 0 &&
      data.subarray(0, 4).equals(Buffer.from('tbl ', 'ascii'))
    ) {
      tableCursor += 1
      if (tableCursor === tableIndex) {
        tableFound = true
        tableLevel = header.level + 1
      }
      continue
    }

    if (!tableFound || tableLevel === undefined) {
      continue
    }

    if (colCount === undefined && header.tagId === TAG.TABLE && header.level === tableLevel) {
      if (data.length < 6) {
        throw new Error(`Malformed TABLE record for reference: ${ref}`)
      }
      colCount = data.readUInt16LE(4)
      targetCellIndex = rowIndex * colCount + colIndex
      continue
    }

    if (targetCellIndex === undefined) {
      continue
    }

    if (header.tagId === TAG.LIST_HEADER && header.level === tableLevel) {
      cellCursor += 1
      if (cellCursor > targetCellIndex && insideTargetCell) {
        throw new Error(`Cell text not found for reference: ${ref}`)
      }
      insideTargetCell = cellCursor === targetCellIndex
      continue
    }

    if (insideTargetCell && header.tagId === TAG.PARA_TEXT && header.level === tableLevel + 1) {
      const patchedData = buildPatchedParaText(data, text)
      return replaceRecordData(stream, offset, patchedData)
    }
  }

  if (!tableFound) {
    throw new Error(`Table not found for reference: ${ref}`)
  }

  throw new Error(`Cell not found for reference: ${ref}`)
}

function applySetFormat(
  cfb: CFB.CFB$Container,
  sectionIndex: number,
  paragraphIndex: number,
  format: FormatOptions,
  compressed: boolean,
  ref: string,
): void {
  const docInfoPath = '/DocInfo'
  let docInfoStream = getEntryBuffer(cfb, docInfoPath)
  if (compressed) {
    docInfoStream = decompressStream(docInfoStream)
  }

  const sectionPath = `/BodyText/Section${sectionIndex}`
  let sectionStream = getEntryBuffer(cfb, sectionPath)
  if (compressed) {
    sectionStream = decompressStream(sectionStream)
  }

  const paraCharShapeMatch = findParagraphCharShapeRecord(sectionStream, paragraphIndex)
  if (!paraCharShapeMatch) {
    throw new Error(`Paragraph not found for reference: ${ref}`)
  }

  const sourceCharShapeId = readParagraphCharShapeRef(paraCharShapeMatch.data)
  const charShapeRecords = findCharShapeRecords(docInfoStream)
  const sourceCharShape = charShapeRecords[sourceCharShapeId]
  if (!sourceCharShape) {
    throw new Error(`CHAR_SHAPE not found for reference: ${ref}`)
  }

  const clonedCharShape = Buffer.from(sourceCharShape)
  applyFormatToCharShape(clonedCharShape, format)

  const idMappings = findIdMappingsRecord(docInfoStream)
  if (!idMappings || idMappings.data.length < 8) {
    throw new Error('ID_MAPPINGS record not found or malformed')
  }

  const currentCharShapeCount = idMappings.data.readUInt32LE(4)
  const nextCharShapeCount = Buffer.from(idMappings.data)
  nextCharShapeCount.writeUInt32LE(currentCharShapeCount + 1, 4)
  docInfoStream = replaceRecordData(docInfoStream, idMappings.offset, nextCharShapeCount)
  docInfoStream = Buffer.concat([docInfoStream, buildRecord(TAG.CHAR_SHAPE, 0, clonedCharShape)])

  const patchedParaCharShape = writeParagraphCharShapeRef(paraCharShapeMatch.data, currentCharShapeCount)
  sectionStream = replaceRecordData(sectionStream, paraCharShapeMatch.offset, patchedParaCharShape)

  CFB.utils.cfb_add(cfb, docInfoPath, compressed ? compressStream(docInfoStream) : docInfoStream)
  CFB.utils.cfb_add(cfb, sectionPath, compressed ? compressStream(sectionStream) : sectionStream)
}

function buildPatchedParaText(originalData: Buffer, nextText: string): Buffer {
  const nextTextData = Buffer.from(nextText, 'utf16le')
  const trailingControls = extractControlChars(originalData)
  if (trailingControls.length === 0) {
    return nextTextData
  }

  return Buffer.concat([nextTextData, ...trailingControls])
}

function extractControlChars(data: Buffer): Buffer[] {
  const controls: Buffer[] = []

  for (let offset = 0; offset + 1 < data.length; offset += 2) {
    const lowByte = data[offset]
    const highByte = data[offset + 1]
    if (highByte === 0 && lowByte < 32) {
      controls.push(Buffer.from(data.subarray(offset, offset + 2)))
    }
  }

  return controls
}

function findParagraphCharShapeRecord(stream: Buffer, paragraphIndex: number): { data: Buffer; offset: number } | null {
  let currentParagraph = -1
  let targetActive = false

  for (const { header, data, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      currentParagraph += 1
      targetActive = currentParagraph === paragraphIndex
      continue
    }

    if (targetActive && header.tagId === TAG.PARA_CHAR_SHAPE) {
      return { data, offset }
    }
  }

  return null
}

function readParagraphCharShapeRef(data: Buffer): number {
  if (data.length >= 12) {
    const count = data.readUInt32LE(0)
    if (count > 0) {
      return data.readUInt32LE(8)
    }
  }

  if (data.length >= 6) {
    return data.readUInt16LE(4)
  }

  return 0
}

function writeParagraphCharShapeRef(data: Buffer, charShapeRef: number): Buffer {
  const next = Buffer.from(data)

  if (next.length >= 12) {
    const count = next.readUInt32LE(0)
    if (count > 0) {
      next.writeUInt32LE(charShapeRef, 8)
      return next
    }
  }

  if (next.length >= 6) {
    next.writeUInt16LE(charShapeRef & 0xffff, 4)
  }

  return next
}

function findCharShapeRecords(stream: Buffer): Buffer[] {
  const records: Buffer[] = []
  for (const { header, data } of iterateRecords(stream)) {
    if (header.tagId === TAG.CHAR_SHAPE) {
      records.push(Buffer.from(data))
    }
  }
  return records
}

function findIdMappingsRecord(stream: Buffer): { data: Buffer; offset: number } | null {
  for (const { header, data, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.ID_MAPPINGS) {
      return { data: Buffer.from(data), offset }
    }
  }
  return null
}

function applyFormatToCharShape(charShape: Buffer, format: FormatOptions): void {
  if (format.fontSize !== undefined && charShape.length >= 46) {
    charShape.writeUInt32LE(Math.round(format.fontSize * 100), 42)
  }

  if (
    (format.bold !== undefined || format.italic !== undefined || format.underline !== undefined) &&
    charShape.length >= 50
  ) {
    let attrBits = charShape.readUInt32LE(46)

    if (format.bold !== undefined) {
      attrBits = setBit(attrBits, 0, format.bold)
    }

    if (format.italic !== undefined) {
      attrBits = setBit(attrBits, 1, format.italic)
    }

    if (format.underline !== undefined) {
      attrBits = setBit(attrBits, 2, format.underline)
    }

    charShape.writeUInt32LE(attrBits >>> 0, 46)
  }

  if (format.color !== undefined && charShape.length >= 56) {
    charShape.writeUInt32LE(parseHexColor(format.color), 52)
  }
}

function setBit(value: number, bitIndex: number, enabled: boolean): number {
  if (enabled) {
    return value | (1 << bitIndex)
  }
  return value & ~(1 << bitIndex)
}

function parseHexColor(hexColor: string): number {
  const normalized = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Invalid color value: ${hexColor}`)
  }
  const rr = Number.parseInt(normalized.slice(0, 2), 16)
  const gg = Number.parseInt(normalized.slice(2, 4), 16)
  const bb = Number.parseInt(normalized.slice(4, 6), 16)
  return (bb << 16) | (gg << 8) | rr
}

function getEntryBuffer(cfb: CFB.CFB$Container, path: string): Buffer {
  const entry = CFB.find(cfb, path)
  if (!entry?.content) {
    throw new Error(`CFB entry not found: ${path}`)
  }
  return Buffer.from(entry.content)
}
