import { readFile, writeFile } from 'node:fs/promises'
import CFB from 'cfb'
import { type EditOperation } from '@/shared/edit-types'
import { parseRef } from '@/shared/refs'
import { iterateRecords } from './record-parser'
import { replaceRecordData } from './record-serializer'
import { compressStream, decompressStream, getCompressionFlag } from './stream-util'
import { TAG } from './tag-ids'

type SectionOperation = {
  paragraph: number
  text: string
  ref: string
}

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
      stream = patchParagraphText(stream, operation)
    }

    CFB.utils.cfb_add(cfb, streamPath, compressed ? compressStream(stream) : stream)
  }

  await writeFile(filePath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
}

function groupOperationsBySection(operations: EditOperation[]): Map<number, SectionOperation[]> {
  const grouped = new Map<number, SectionOperation[]>()

  for (const operation of operations) {
    if (operation.type !== 'setText') {
      throw new Error(`Unsupported HWP edit operation: ${operation.type}`)
    }

    const ref = parseRef(operation.ref)
    if (ref.paragraph === undefined) {
      throw new Error(`setText requires paragraph reference: ${operation.ref}`)
    }

    const sectionOperations = grouped.get(ref.section) ?? []
    sectionOperations.push({ paragraph: ref.paragraph, text: operation.text, ref: operation.ref })
    grouped.set(ref.section, sectionOperations)
  }

  return grouped
}

function patchParagraphText(stream: Buffer, operation: SectionOperation): Buffer {
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

function getEntryBuffer(cfb: CFB.CFB$Container, path: string): Buffer {
  const entry = CFB.find(cfb, path)
  if (!entry?.content) {
    throw new Error(`CFB entry not found: ${path}`)
  }
  return Buffer.from(entry.content)
}
