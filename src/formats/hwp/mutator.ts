import CFB from 'cfb'
import { type EditOperation, type FormatOptions } from '@/shared/edit-types'
import { parseRef } from '@/shared/refs'
import { readControlId } from './control-id'
import { iterateRecords } from './record-parser'
import { buildRecord, replaceRecordData } from './record-serializer'
import { compressStream, decompressStream } from './stream-util'
import { TAG } from './tag-ids'

type SectionTextOperation = {
  type: 'setText'
  paragraph?: number
  textBox?: number
  textBoxParagraph?: number
  text: string
  ref: string
}

type SectionTableCellOperation = {
  type: 'setTableCell'
  table: number
  row: number
  cell: number
  paragraph?: number
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

export function mutateHwpCfb(cfb: CFB.CFB$Container, operations: EditOperation[], compressed: boolean): void {
  if (operations.length === 0) return

  const operationsBySection = groupOperationsBySection(operations)

  for (const [sectionIndex, sectionOperations] of operationsBySection.entries()) {
    const streamPath = `/BodyText/Section${sectionIndex}`
    let stream = getEntryBuffer(cfb, streamPath)
    if (compressed) {
      stream = decompressStream(stream)
    }

    for (const operation of sectionOperations) {
      if (operation.type === 'setText') {
        if (operation.textBox !== undefined) {
          stream = patchTextBoxText(
            stream,
            operation.textBox,
            operation.textBoxParagraph ?? 0,
            operation.text,
            operation.ref,
          )
        } else {
          stream = patchParagraphText(stream, operation)
        }
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

      stream = patchTableCellText(
        stream,
        operation.table,
        operation.row,
        operation.cell,
        operation.paragraph ?? 0,
        operation.text,
        operation.ref,
      )
    }

    CFB.utils.cfb_add(cfb, streamPath, compressed ? compressStream(stream) : stream)
  }
}

function groupOperationsBySection(operations: EditOperation[]): Map<number, SectionOperation[]> {
  const grouped = new Map<number, SectionOperation[]>()

  for (const operation of operations) {
    if (operation.type === 'setText') {
      const ref = parseRef(operation.ref)
      if (ref.textBox !== undefined) {
        if (ref.textBoxParagraph === undefined) {
          throw new Error(`setText requires textbox paragraph reference: ${operation.ref}`)
        }

        const sectionOperations = grouped.get(ref.section) ?? []
        sectionOperations.push({
          type: 'setText',
          textBox: ref.textBox,
          textBoxParagraph: ref.textBoxParagraph,
          text: operation.text,
          ref: operation.ref,
        })
        grouped.set(ref.section, sectionOperations)
        continue
      }

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
        paragraph: ref.cellParagraph,
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
  let paraHeaderDataOffset: number | undefined
  let paraHeaderDataSize = 0

  for (const { header, data, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      paragraphIndex += 1
      waitingForTargetText = paragraphIndex === operation.paragraph
      if (waitingForTargetText) {
        paraHeaderDataOffset = offset + header.headerSize
        paraHeaderDataSize = header.size
      }
      continue
    }

    if (waitingForTargetText && header.tagId === TAG.PARA_TEXT) {
      const patchedData = buildPatchedParaText(data, operation.text)
      const newStream = replaceRecordData(stream, offset, patchedData)
      updateParaHeaderNChars(newStream, paraHeaderDataOffset, paraHeaderDataSize, patchedData.length / 2)
      return newStream
    }
  }

  throw new Error(`Paragraph not found for reference: ${operation.ref}`)
}

function parseCellAddress(data: Buffer): { col: number; row: number } | null {
  const commonHeaderSize = data.length === 30 ? 6 : 8
  if (data.length < commonHeaderSize + 4) {
    return null
  }

  return {
    col: data.readUInt16LE(commonHeaderSize),
    row: data.readUInt16LE(commonHeaderSize + 2),
  }
}

function patchTableCellText(
  stream: Buffer,
  tableIndex: number,
  rowIndex: number,
  colIndex: number,
  paragraph = 0,
  text: string,
  ref: string,
): Buffer {
  let tableCursor = -1
  let tableFound = false
  let tableLevel: number | undefined
  let colCount: number | undefined
  let cellCursor = -1
  let insideTargetCell = false
  let paragraphCursor = -1
  let paraHeaderDataOffset: number | undefined
  let paraHeaderDataSize = 0

  for (const { header, data, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.CTRL_HEADER && header.level > 0 && readControlId(data) === 'tbl ') {
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
      if (data.length < 8) {
        throw new Error(`Malformed TABLE record for reference: ${ref}`)
      }
      colCount = data.readUInt16LE(6)
      continue
    }

    if (header.tagId === TAG.LIST_HEADER && header.level === tableLevel) {
      cellCursor += 1
      const parsed = parseCellAddress(data)
      if (parsed !== null) {
        insideTargetCell = parsed.col === colIndex && parsed.row === rowIndex
      } else if (colCount === undefined) {
        insideTargetCell = false
      } else {
        const targetCellIndex = rowIndex * colCount + colIndex
        insideTargetCell = cellCursor === targetCellIndex
      }
      paraHeaderDataOffset = undefined
      paraHeaderDataSize = 0
      paragraphCursor = -1
      continue
    }

    if (insideTargetCell && header.tagId === TAG.PARA_HEADER) {
      paraHeaderDataOffset = offset + header.headerSize
      paraHeaderDataSize = header.size
      continue
    }

    if (insideTargetCell && header.tagId === TAG.PARA_TEXT && header.level === tableLevel + 1) {
      paragraphCursor += 1
      if (paragraphCursor !== paragraph) {
        continue
      }

      const patchedData = buildPatchedParaText(data, text)
      const newStream = replaceRecordData(stream, offset, patchedData)
      updateParaHeaderNChars(newStream, paraHeaderDataOffset, paraHeaderDataSize, patchedData.length / 2)
      return newStream
    }
  }

  if (!tableFound) {
    throw new Error(`Table not found for reference: ${ref}`)
  }

  throw new Error(`Cell not found for reference: ${ref}`)
}

function patchTextBoxText(
  stream: Buffer,
  textBoxIndex: number,
  paragraphIndex: number,
  text: string,
  ref: string,
): Buffer {
  let textBoxCursor = -1
  let pendingGsoLevel: number | undefined
  let targetShapeLevel: number | undefined
  let targetShapeConfirmed = false
  let insideTargetTextBox = false
  let textBoxParagraphCursor = -1
  let paraHeaderDataOffset: number | undefined
  let paraHeaderDataSize = 0

  for (const { header, data, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.CTRL_HEADER && readControlId(data) === 'gso ') {
      pendingGsoLevel = header.level
      continue
    }

    if (pendingGsoLevel !== undefined && header.tagId === TAG.SHAPE_COMPONENT && header.level === pendingGsoLevel + 1) {
      const subtype = readControlId(data)
      if (subtype === '$rec') {
        textBoxCursor += 1
        if (textBoxCursor === textBoxIndex) {
          targetShapeLevel = header.level
          targetShapeConfirmed = false
          insideTargetTextBox = false
          textBoxParagraphCursor = -1
          paraHeaderDataOffset = undefined
          paraHeaderDataSize = 0
        }
      }
      pendingGsoLevel = undefined
      continue
    }

    if (
      targetShapeLevel !== undefined &&
      !targetShapeConfirmed &&
      header.tagId === TAG.SHAPE_COMPONENT_RECTANGLE &&
      header.level === targetShapeLevel + 1
    ) {
      targetShapeConfirmed = true
      continue
    }

    if (
      targetShapeLevel !== undefined &&
      targetShapeConfirmed &&
      header.tagId === TAG.LIST_HEADER &&
      header.level === targetShapeLevel
    ) {
      insideTargetTextBox = true
      textBoxParagraphCursor = -1
      paraHeaderDataOffset = undefined
      paraHeaderDataSize = 0
      continue
    }

    if (!insideTargetTextBox || targetShapeLevel === undefined) {
      continue
    }

    if (header.level <= targetShapeLevel && header.tagId !== TAG.PARA_HEADER && header.tagId !== TAG.PARA_TEXT) {
      break
    }

    if (header.tagId === TAG.PARA_HEADER && header.level === targetShapeLevel + 1) {
      textBoxParagraphCursor += 1
      if (textBoxParagraphCursor > paragraphIndex) {
        throw new Error(`Text box paragraph not found for reference: ${ref}`)
      }

      if (textBoxParagraphCursor === paragraphIndex) {
        paraHeaderDataOffset = offset + header.headerSize
        paraHeaderDataSize = header.size
      }
      continue
    }

    if (
      textBoxParagraphCursor === paragraphIndex &&
      header.tagId === TAG.PARA_TEXT &&
      header.level === targetShapeLevel + 2
    ) {
      const patchedData = buildPatchedParaText(data, text)
      const newStream = replaceRecordData(stream, offset, patchedData)
      updateParaHeaderNChars(newStream, paraHeaderDataOffset, paraHeaderDataSize, patchedData.length / 2)
      return newStream
    }
  }

  if (textBoxCursor < textBoxIndex) {
    throw new Error(`Text box not found for reference: ${ref}`)
  }

  throw new Error(`Text box paragraph not found for reference: ${ref}`)
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

  const charShapeCountOffset = findCharShapeCountOffset(idMappings.data, charShapeRecords.length)
  const currentCharShapeCount = idMappings.data.readUInt32LE(charShapeCountOffset)
  const patchedIdMappings = Buffer.from(idMappings.data)
  patchedIdMappings.writeUInt32LE(currentCharShapeCount + 1, charShapeCountOffset)
  docInfoStream = replaceRecordData(docInfoStream, idMappings.offset, patchedIdMappings)

  const insertionOffset = findLastCharShapeRecordEnd(docInfoStream)
  const newRecord = buildRecord(TAG.CHAR_SHAPE, 1, clonedCharShape)
  docInfoStream = Buffer.concat([
    docInfoStream.subarray(0, insertionOffset),
    newRecord,
    docInfoStream.subarray(insertionOffset),
  ])

  const patchedParaCharShape = writeParagraphCharShapeRef(paraCharShapeMatch.data, currentCharShapeCount)
  sectionStream = replaceRecordData(sectionStream, paraCharShapeMatch.offset, patchedParaCharShape)

  CFB.utils.cfb_add(cfb, docInfoPath, compressed ? compressStream(docInfoStream) : docInfoStream)
  CFB.utils.cfb_add(cfb, sectionPath, compressed ? compressStream(sectionStream) : sectionStream)
}

function updateParaHeaderNChars(
  stream: Buffer,
  paraHeaderDataOffset: number | undefined,
  paraHeaderDataSize: number,
  nChars: number,
): void {
  if (paraHeaderDataOffset !== undefined && paraHeaderDataSize >= 4) {
    const original = stream.readUInt32LE(paraHeaderDataOffset)
    const flags = original & 0x80000000
    stream.writeUInt32LE((flags | (nChars & 0x7fffffff)) >>> 0, paraHeaderDataOffset)
  }
}

const PARA_END_MARKER = Buffer.from([0x0d, 0x00])
function buildPatchedParaText(originalData: Buffer, nextText: string): Buffer {
  const nextTextData = Buffer.from(nextText, 'utf16le')
  if (hasTrailingParaEnd(originalData)) {
    return Buffer.concat([nextTextData, PARA_END_MARKER])
  }
  return nextTextData
}

function hasTrailingParaEnd(data: Buffer): boolean {
  if (data.length < 2) return false
  return data[data.length - 2] === 0x0d && data[data.length - 1] === 0x00
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

// HWP 5.0 ID_MAPPINGS: binData(1) + faceNames(7) + borderFill(1) = 9 fields before charShape
const HWP5_CHAR_SHAPE_FIELD_INDEX = 9
const HWP5_CHAR_SHAPE_BYTE_OFFSET = HWP5_CHAR_SHAPE_FIELD_INDEX * 4

function findCharShapeCountOffset(idMappingsData: Buffer, actualCharShapeCount: number): number {
  if (idMappingsData.length >= HWP5_CHAR_SHAPE_BYTE_OFFSET + 4) {
    return HWP5_CHAR_SHAPE_BYTE_OFFSET
  }

  for (let offset = 0; offset + 4 <= idMappingsData.length; offset += 4) {
    if (idMappingsData.readUInt32LE(offset) === actualCharShapeCount) {
      return offset
    }
  }

  throw new Error('Cannot locate charShape count in ID_MAPPINGS')
}

function findLastCharShapeRecordEnd(stream: Buffer): number {
  let lastEnd = stream.length
  for (const { header, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.CHAR_SHAPE) {
      lastEnd = offset + header.headerSize + header.size
    }
  }
  return lastEnd
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

export function getEntryBuffer(cfb: CFB.CFB$Container, path: string): Buffer {
  const entry = CFB.find(cfb, path)
  if (!entry?.content) {
    throw new Error(`CFB entry not found: ${path}`)
  }
  return Buffer.from(entry.content)
}
