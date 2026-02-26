import CFB from 'cfb'
import { type EditOperation, type FormatOptions } from '@/shared/edit-types'
import { parseRef } from '@/shared/refs'
import { controlIdBuffer, readControlId } from './control-id'
import { iterateRecords } from './record-parser'
import { buildCellListHeaderData, buildRecord, buildTableData, replaceRecordData } from './record-serializer'
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
  start?: number
  end?: number
  ref: string
}

type SectionAddTableOperation = {
  type: 'addTable'
  rows: number
  cols: number
  data?: string[][]
  ref: string
}

type SectionAddParagraphOperation = {
  type: 'addParagraph'
  paragraph?: number
  text: string
  position: 'before' | 'after' | 'end'
  format?: FormatOptions
  ref: string
}

type SectionOperation =
  | SectionTextOperation
  | SectionTableCellOperation
  | SectionFormatOperation
  | SectionAddTableOperation
  | SectionAddParagraphOperation

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
        applySetFormat(
          cfb,
          sectionIndex,
          operation.paragraph,
          operation.format,
          compressed,
          operation.ref,
          operation.start,
          operation.end,
        )
        stream = getEntryBuffer(cfb, streamPath)
        if (compressed) {
          stream = decompressStream(stream)
        }
        continue
      }

      if (operation.type === 'addTable') {
        stream = appendTableRecords(stream, operation)
        continue
      }

      if (operation.type === 'addParagraph') {
        stream = appendParagraphRecords(stream, operation, cfb, sectionIndex, compressed)
        continue
      }

      // At this point, operation must be setTableCell
      const cellOp = operation as SectionTableCellOperation
      stream = patchTableCellText(
        stream,
        cellOp.table,
        cellOp.row,
        cellOp.cell,
        cellOp.paragraph ?? 0,
        cellOp.text,
        cellOp.ref,
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
        start: operation.start,
        end: operation.end,
        ref: operation.ref,
      })
      grouped.set(ref.section, sectionOperations)
      continue
    }

    if (operation.type === 'addTable') {
      const ref = parseRef(operation.ref)
      const sectionOperations = grouped.get(ref.section) ?? []
      sectionOperations.push({
        type: 'addTable',
        rows: operation.rows,
        cols: operation.cols,
        data: operation.data,
        ref: operation.ref,
      })
      grouped.set(ref.section, sectionOperations)
      continue
    }

    if (operation.type === 'addParagraph') {
      const ref = parseRef(operation.ref)
      const sectionOperations = grouped.get(ref.section) ?? []
      sectionOperations.push({
        type: 'addParagraph',
        paragraph: ref.paragraph,
        text: operation.text,
        position: operation.position,
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

function appendTableRecords(stream: Buffer, op: SectionAddTableOperation): Buffer {
  const records: Buffer[] = [stream]

  const tableParaHeader = Buffer.alloc(24)
  tableParaHeader.writeUInt32LE(1, 0)
  tableParaHeader.writeUInt32LE(1, 16)

  const tableParaLineSeg = buildParaLineSegData()

  records.push(buildRecord(TAG.PARA_HEADER, 0, tableParaHeader))
  records.push(buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x000b])))
  const tableParaCharShape = Buffer.alloc(8)
  tableParaCharShape.writeUInt32LE(0, 0) // position
  tableParaCharShape.writeUInt32LE(0, 4) // charShapeRef = 0 (default)
  records.push(buildRecord(TAG.PARA_CHAR_SHAPE, 1, tableParaCharShape))
  records.push(buildRecord(TAG.PARA_LINE_SEG, 1, tableParaLineSeg))
  records.push(buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('tbl ')))
  records.push(buildRecord(TAG.TABLE, 2, buildTableData(op.rows, op.cols)))

  for (let row = 0; row < op.rows; row++) {
    for (let col = 0; col < op.cols; col++) {
      const cellText = op.data?.[row]?.[col] ?? ''
      const cellTextData = Buffer.from(cellText, 'utf16le')
      const cellParaHeader = Buffer.alloc(24)
      cellParaHeader.writeUInt32LE((0x80000000 | (cellTextData.length / 2)) >>> 0, 0)
      const cellParaCharShape = Buffer.alloc(8)
      cellParaCharShape.writeUInt32LE(0, 0) // position
      cellParaCharShape.writeUInt32LE(0, 4) // charShapeRef = 0 (default)
      const cellParaLineSeg = buildParaLineSegData()
      records.push(buildRecord(TAG.LIST_HEADER, 2, buildCellListHeaderData(col, row, 1, 1)))
      records.push(buildRecord(TAG.PARA_HEADER, 3, cellParaHeader))
      records.push(buildRecord(TAG.PARA_TEXT, 3, cellTextData))
      records.push(buildRecord(TAG.PARA_CHAR_SHAPE, 3, cellParaCharShape))
      records.push(buildRecord(TAG.PARA_LINE_SEG, 3, cellParaLineSeg))
    }
  }

  return Buffer.concat(records)
}

function appendParagraphRecords(
  stream: Buffer,
  op: SectionAddParagraphOperation,
  cfb: CFB.CFB$Container,
  sectionIndex: number,
  compressed: boolean,
): Buffer {
  void sectionIndex

  const charShapeRef =
    op.format && hasFormatOptions(op.format) ? addCharShapeWithFormat(cfb, compressed, 0, op.format) : 0

  const textData = Buffer.from(op.text, 'utf16le')
  const nChars = textData.length / 2 + 1

  const paraHeaderData = Buffer.alloc(24)
  paraHeaderData.writeUInt32LE(nChars & 0x7fffffff, 0)
  paraHeaderData.writeUInt32LE(1, 16)

  const paraTextData = Buffer.concat([textData, Buffer.from([0x0d, 0x00])])

  const paraCharShapeData = Buffer.alloc(8)
  paraCharShapeData.writeUInt32LE(0, 0)
  paraCharShapeData.writeUInt32LE(charShapeRef, 4)

  const paraLineSegData = buildParaLineSegData()

  const newRecords = Buffer.concat([
    buildRecord(TAG.PARA_HEADER, 0, paraHeaderData),
    buildRecord(TAG.PARA_TEXT, 1, paraTextData),
    buildRecord(TAG.PARA_CHAR_SHAPE, 1, paraCharShapeData),
    buildRecord(TAG.PARA_LINE_SEG, 1, paraLineSegData),
  ])

  if (op.position === 'end') {
    const result = clearLastParagraphBit(stream)
    paraHeaderData.writeUInt32LE((0x80000000 | (nChars & 0x7fffffff)) >>> 0, 0)
    const finalRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, paraHeaderData),
      buildRecord(TAG.PARA_TEXT, 1, paraTextData),
      buildRecord(TAG.PARA_CHAR_SHAPE, 1, paraCharShapeData),
      buildRecord(TAG.PARA_LINE_SEG, 1, paraLineSegData),
    ])
    return Buffer.concat([result, finalRecords])
  }

  if (op.paragraph === undefined) {
    throw new Error(`addParagraph with position '${op.position}' requires a paragraph reference: ${op.ref}`)
  }

  return spliceParagraphRecords(stream, op.paragraph, op.position, newRecords)
}

function clearLastParagraphBit(stream: Buffer): Buffer {
  const result = Buffer.from(stream)
  for (const { header, data, offset } of iterateRecords(result)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      if (data.length < 4) continue
      const nCharsField = data.readUInt32LE(0)
      if (nCharsField & 0x80000000) {
        const dataOffset = offset + header.headerSize
        result.writeUInt32LE((nCharsField & 0x7fffffff) >>> 0, dataOffset)
        break
      }
    }
  }
  return result
}

function spliceParagraphRecords(
  stream: Buffer,
  paragraphIndex: number,
  position: 'before' | 'after',
  newRecords: Buffer,
): Buffer {
  let currentParagraph = -1
  let targetStart: number | undefined
  let targetEnd: number | undefined

  for (const { header, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      currentParagraph += 1
      if (currentParagraph === paragraphIndex) {
        targetStart = offset
      } else if (currentParagraph === paragraphIndex + 1 && targetStart !== undefined) {
        targetEnd = offset
        break
      }
    }
  }

  if (targetStart === undefined) {
    throw new Error(`Paragraph not found at index ${paragraphIndex}`)
  }

  if (targetEnd === undefined) {
    targetEnd = stream.length
  }

  const insertAt = position === 'before' ? targetStart : targetEnd

  return Buffer.concat([stream.subarray(0, insertAt), newRecords, stream.subarray(insertAt)])
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
      let newStream = replaceRecordData(stream, offset, patchedData)
      updateParaHeaderNChars(newStream, paraHeaderDataOffset, paraHeaderDataSize, patchedData.length / 2)
      newStream = resetParagraphCharShape(newStream, operation.paragraph ?? 0)
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
  start?: number,
  end?: number,
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

  const hasInlineRange = start !== undefined || end !== undefined
  if (hasInlineRange && (start === undefined || end === undefined)) {
    throw new Error(`setFormat range requires both start and end offsets: ${ref}`)
  }

  let patchedParaCharShape: Buffer
  if (start !== undefined && end !== undefined) {
    const paraText = findParagraphTextRecord(sectionStream, paragraphIndex)
    const textLength = paraText ? countVisibleChars(paraText.data) : 0
    if (start < 0 || end > textLength || start >= end) {
      throw new Error(`Offset out of range: start=${start}, end=${end}, length=${textLength}`)
    }

    const entries: Array<{ pos: number; ref: number }> = []
    if (start > 0) {
      entries.push({ pos: 0, ref: sourceCharShapeId })
    }
    entries.push({ pos: start, ref: currentCharShapeCount })
    if (end < textLength) {
      entries.push({ pos: end, ref: sourceCharShapeId })
    }

    patchedParaCharShape = Buffer.alloc(entries.length * 8)
    for (let i = 0; i < entries.length; i++) {
      patchedParaCharShape.writeUInt32LE(entries[i].pos, i * 8)
      patchedParaCharShape.writeUInt32LE(entries[i].ref, i * 8 + 4)
    }
  } else {
    patchedParaCharShape = writeParagraphCharShapeRef(paraCharShapeMatch.data, currentCharShapeCount)
  }

  sectionStream = replaceRecordData(sectionStream, paraCharShapeMatch.offset, patchedParaCharShape)

  CFB.utils.cfb_add(cfb, docInfoPath, compressed ? compressStream(docInfoStream) : docInfoStream)
  CFB.utils.cfb_add(cfb, sectionPath, compressed ? compressStream(sectionStream) : sectionStream)
}

function findParagraphTextRecord(stream: Buffer, paragraphIndex: number): { data: Buffer; offset: number } | null {
  let currentParagraph = -1
  let targetActive = false

  for (const { header, data, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      currentParagraph += 1
      targetActive = currentParagraph === paragraphIndex
      continue
    }

    if (targetActive && header.tagId === TAG.PARA_TEXT) {
      return { data, offset }
    }
  }

  return null
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

function charByteSize(code: number): number {
  if (code === 0x0009 || code === 0x000a || code === 0x000d) return 2
  if (code < 0x0020) return 8
  return 2
}

function countVisibleChars(data: Buffer): number {
  let count = 0
  let offset = 0

  while (offset + 1 < data.length) {
    const code = data.readUInt16LE(offset)
    if (code >= 0x0020) {
      count += 1
    }
    offset += charByteSize(code)
  }

  return count
}

function buildPatchedParaText(originalData: Buffer, nextText: string): Buffer {
  const nextTextData = Buffer.from(nextText, 'utf16le')
  const parts: Buffer[] = []
  let textInserted = false
  let offset = 0

  while (offset + 1 < originalData.length) {
    const code = originalData.readUInt16LE(offset)
    const size = charByteSize(code)
    const end = Math.min(offset + size, originalData.length)

    if (code >= 0x0020) {
      if (!textInserted) {
        parts.push(nextTextData)
        textInserted = true
      }
    } else {
      parts.push(originalData.subarray(offset, end))
    }

    offset = end
  }

  if (!textInserted) {
    const last = parts[parts.length - 1]
    if (last && last.length === 2 && last.readUInt16LE(0) === 0x000d) {
      parts.splice(parts.length - 1, 0, nextTextData)
    } else {
      parts.push(nextTextData)
    }
  }

  return Buffer.concat(parts)
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

function resetParagraphCharShape(stream: Buffer, paragraphIndex: number): Buffer {
  const match = findParagraphCharShapeRecord(stream, paragraphIndex)
  if (!match) return stream

  const charShapeId = readParagraphCharShapeRef(match.data)
  const newData = Buffer.alloc(8)
  newData.writeUInt32LE(0, 0)
  newData.writeUInt32LE(charShapeId, 4)

  return replaceRecordData(stream, match.offset, newData)
}

function readParagraphCharShapeRef(data: Buffer): number {
  // Standard format: array of (pos: uint32, ref: uint32) pairs
  if (data.length >= 8 && data.length % 8 === 0) {
    return data.readUInt32LE(4)
  }
  // Legacy short format: 6 bytes with charShapeRef as uint16 at offset 4
  if (data.length >= 6) {
    return data.readUInt16LE(4)
  }
  return 0
}
function writeParagraphCharShapeRef(data: Buffer, charShapeRef: number): Buffer {
  const next = Buffer.from(data)
  // Standard format: array of (pos: uint32, ref: uint32) pairs
  if (data.length >= 8 && data.length % 8 === 0) {
    const entryCount = data.length / 8
    for (let i = 0; i < entryCount; i++) {
      next.writeUInt32LE(charShapeRef, i * 8 + 4)
    }
    return next
  }
  // Legacy short format: charShapeRef as uint16 at offset 4
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

function hasFormatOptions(format: FormatOptions): boolean {
  return (
    format.bold !== undefined ||
    format.italic !== undefined ||
    format.underline !== undefined ||
    format.fontName !== undefined ||
    format.fontSize !== undefined ||
    format.color !== undefined
  )
}

function addCharShapeWithFormat(
  cfb: CFB.CFB$Container,
  compressed: boolean,
  sourceCharShapeId: number,
  format: FormatOptions,
): number {
  const docInfoPath = '/DocInfo'
  let docInfoStream = getEntryBuffer(cfb, docInfoPath)
  if (compressed) {
    docInfoStream = decompressStream(docInfoStream)
  }

  const charShapeRecords = findCharShapeRecords(docInfoStream)
  const sourceCharShape = charShapeRecords[sourceCharShapeId]
  if (!sourceCharShape) {
    throw new Error(`CHAR_SHAPE[${sourceCharShapeId}] not found`)
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

  CFB.utils.cfb_add(cfb, docInfoPath, compressed ? compressStream(docInfoStream) : docInfoStream)
  return currentCharShapeCount
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

function encodeUint16(values: number[]): Buffer {
  const output = Buffer.alloc(values.length * 2)
  for (const [index, value] of values.entries()) {
    output.writeUInt16LE(value, index * 2)
  }
  return output
}

function buildParaLineSegData(): Buffer {
  const buf = Buffer.alloc(36)
  buf.writeUInt32LE(0x000009a0, 8)
  buf.writeUInt32LE(0x000009a0, 12)
  buf.writeUInt32LE(0x000007f8, 16)
  buf.writeInt32LE(-0x00000690, 20)
  buf.writeUInt16LE(0x0006, 34)
  return buf
}

export function getEntryBuffer(cfb: CFB.CFB$Container, path: string): Buffer {
  const entry = CFB.find(cfb, path)
  if (!entry?.content) {
    throw new Error(`CFB entry not found: ${path}`)
  }
  return Buffer.from(entry.content)
}
