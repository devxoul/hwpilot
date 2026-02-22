import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import CFB from 'cfb'
import { createTestHwpBinary } from '../../test-helpers'
import { loadHwp } from './reader'
import { iterateRecords } from './record-parser'
import { decompressStream, getCompressionFlag } from './stream-util'
import { TAG } from './tag-ids'
import { editHwp } from './writer'

const TMP_FILES: string[] = []

afterEach(async () => {
  await Promise.all(
    TMP_FILES.splice(0).map(async (filePath) => {
      await Bun.file(filePath).delete()
    }),
  )
})

describe('editHwp', () => {
  it('setText on first paragraph changes target and keeps second paragraph', async () => {
    const filePath = tmpPath('writer-set-text')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['first', 'second'] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setText', ref: 's0.p0', text: 'changed' }])

    const doc = await loadHwp(filePath)
    expect(joinRuns(doc.sections[0].paragraphs[0].runs)).toBe('changed')
    expect(joinRuns(doc.sections[0].paragraphs[1].runs)).toBe('second')
  })

  it('setText supports Korean UTF-16LE content', async () => {
    const filePath = tmpPath('writer-korean')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['기존 텍스트'] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setText', ref: 's0.p0', text: '안녕하세요 한글' }])

    const doc = await loadHwp(filePath)
    expect(joinRuns(doc.sections[0].paragraphs[0].runs)).toBe('안녕하세요 한글')
  })

  it('setText supports longer text than original record size', async () => {
    const filePath = tmpPath('writer-longer')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['a'] })
    await Bun.write(filePath, fixture)

    const nextText = 'this is a much longer replacement paragraph text'
    await editHwp(filePath, [{ type: 'setText', ref: 's0.p0', text: nextText }])

    const doc = await loadHwp(filePath)
    expect(joinRuns(doc.sections[0].paragraphs[0].runs)).toBe(nextText)
  })

  it('setText on compressed file preserves compression flag', async () => {
    const filePath = tmpPath('writer-compressed')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['before'], compressed: true })
    await Bun.write(filePath, fixture)

    const beforeHeader = await getFileHeader(filePath)
    expect(getCompressionFlag(beforeHeader)).toBe(true)

    await editHwp(filePath, [{ type: 'setText', ref: 's0.p0', text: 'after' }])

    const afterHeader = await getFileHeader(filePath)
    expect(getCompressionFlag(afterHeader)).toBe(true)

    const doc = await loadHwp(filePath)
    expect(joinRuns(doc.sections[0].paragraphs[0].runs)).toBe('after')
  })

  it('setText keeps untouched paragraph PARA_TEXT records byte-identical', async () => {
    const filePath = tmpPath('writer-byte-identical')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['one', 'two', 'three'] })
    await Bun.write(filePath, fixture)

    const beforeSection = await getSectionBuffer(filePath, 0)
    const beforeParaTextRecords = collectTopLevelParaTextRecords(beforeSection)

    await editHwp(filePath, [{ type: 'setText', ref: 's0.p1', text: 'middle changed and longer' }])

    const afterSection = await getSectionBuffer(filePath, 0)
    const afterParaTextRecords = collectTopLevelParaTextRecords(afterSection)

    expect(afterParaTextRecords).toHaveLength(3)
    expect(Buffer.compare(beforeParaTextRecords[0], afterParaTextRecords[0])).toBe(0)
    expect(Buffer.compare(beforeParaTextRecords[2], afterParaTextRecords[2])).toBe(0)
  })

  it('setText updates PARA_HEADER nChars to match new text length', async () => {
    const filePath = tmpPath('writer-nchars')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['original text'] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setText', ref: 's0.p0', text: 'new' }])

    const section = await getSectionBuffer(filePath, 0)
    const { nChars, textLength } = readParaHeaderAndTextLength(section, 0)
    expect(nChars).toBe(textLength)
    expect(nChars).toBe(3)
  })

  it('setTableCell updates PARA_HEADER nChars in target cell', async () => {
    const filePath = tmpPath('writer-table-nchars')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ tables: [{ rows: [['original', 'B']] }] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setTableCell', ref: 's0.t0.r0.c0', text: 'XY' }])

    const doc = await loadHwp(filePath)
    expect(doc.sections[0].tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('XY')
  })

  it('setTableCell preserves bit 31 flag in PARA_HEADER nChars', async () => {
    const filePath = tmpPath('writer-table-nchars-bit31')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ tables: [{ rows: [['original text', 'B']] }] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setTableCell', ref: 's0.t0.r0.c0', text: 'XY' }])

    const section = await getSectionBuffer(filePath, 0)
    const nChars = readTableCellParaHeaderNChars(section, 0)
    expect((nChars & 0x80000000) >>> 0).toBe(0x80000000)
    expect((nChars & 0x7fffffff) >>> 0).toBe(2)
  })

  it('setFormat bold creates new char shape and updates paragraph reference', async () => {
    const filePath = tmpPath('writer-set-format-bold')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['first', 'second'] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setFormat', ref: 's0.p0', format: { bold: true } }])

    const doc = await loadHwp(filePath)
    const firstRunRef = doc.sections[0].paragraphs[0].runs[0].charShapeRef
    const firstCharShape = doc.header.charShapes[firstRunRef]
    expect(firstCharShape.bold).toBe(true)
    expect(doc.header.charShapes).toHaveLength(2)
    expect(doc.header.charShapes[0].bold).toBe(false)
  })

  it('setFormat fontSize creates new char shape with requested size', async () => {
    const filePath = tmpPath('writer-set-format-font-size')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['first'] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setFormat', ref: 's0.p0', format: { fontSize: 14 } }])

    const doc = await loadHwp(filePath)
    const runRef = doc.sections[0].paragraphs[0].runs[0].charShapeRef
    expect(doc.header.charShapes[runRef].fontSize).toBe(14)
  })

  it('setFormat increments ID_MAPPINGS char shape count by one', async () => {
    const filePath = tmpPath('writer-set-format-id-mappings')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['first'] })
    await Bun.write(filePath, fixture)

    const beforeDocInfo = await getDocInfoBuffer(filePath)
    const beforeCount = readIdMappingsCharShapeCount(beforeDocInfo)

    await editHwp(filePath, [{ type: 'setFormat', ref: 's0.p0', format: { bold: true } }])

    const afterDocInfo = await getDocInfoBuffer(filePath)
    const afterCount = readIdMappingsCharShapeCount(afterDocInfo)
    expect(afterCount).toBe(beforeCount + 1)
  })

  it('setFormat keeps original paragraph char shape unchanged', async () => {
    const filePath = tmpPath('writer-set-format-immutable-source')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['first', 'second'] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setFormat', ref: 's0.p1', format: { bold: true } }])

    const doc = await loadHwp(filePath)
    const firstRunRef = doc.sections[0].paragraphs[0].runs[0].charShapeRef
    const secondRunRef = doc.sections[0].paragraphs[1].runs[0].charShapeRef

    expect(firstRunRef).toBe(0)
    expect(doc.header.charShapes[firstRunRef].bold).toBe(false)
    expect(secondRunRef).toBe(1)
    expect(doc.header.charShapes[secondRunRef].bold).toBe(true)
  })

  it('setFormat writes font size and color to CHAR_SHAPE offsets 42 and 52', async () => {
    const filePath = tmpPath('writer-set-format-char-shape-offsets')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['first'] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setFormat', ref: 's0.p0', format: { fontSize: 12, color: '#FF0000' } }])

    const docInfo = await getDocInfoBuffer(filePath)
    const charShapeRecords = collectCharShapeRecordData(docInfo)
    const updatedCharShape = charShapeRecords[charShapeRecords.length - 1]

    expect(updatedCharShape.readUInt32LE(42)).toBe(1200)
    expect(updatedCharShape.readUInt32LE(52)).toBe(0x0000ff)
  })

  it('setTableCell updates target cell and keeps other cells unchanged', async () => {
    const filePath = tmpPath('writer-table-cell-first')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ tables: [{ rows: [['A', 'B']] }] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setTableCell', ref: 's0.t0.r0.c0', text: 'Changed' }])

    const doc = await loadHwp(filePath)
    expect(doc.sections[0].tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('Changed')
    expect(doc.sections[0].tables[0].rows[0].cells[1].paragraphs[0].runs[0].text).toBe('B')
  })

  it('setTableCell uses row-major indexing for table cells', async () => {
    const filePath = tmpPath('writer-table-cell-row-major')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({
      tables: [
        {
          rows: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
      ],
    })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setTableCell', ref: 's0.t0.r1.c1', text: 'Changed' }])

    const doc = await loadHwp(filePath)
    expect(doc.sections[0].tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('A')
    expect(doc.sections[0].tables[0].rows[0].cells[1].paragraphs[0].runs[0].text).toBe('B')
    expect(doc.sections[0].tables[0].rows[1].cells[0].paragraphs[0].runs[0].text).toBe('C')
    expect(doc.sections[0].tables[0].rows[1].cells[1].paragraphs[0].runs[0].text).toBe('Changed')
  })

  it('setTableCell throws descriptive error for missing table', async () => {
    const filePath = tmpPath('writer-table-cell-missing-table')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ tables: [{ rows: [['A']] }] })
    await Bun.write(filePath, fixture)

    await expect(editHwp(filePath, [{ type: 'setTableCell', ref: 's0.t1.r0.c0', text: 'X' }])).rejects.toThrow(
      'Table not found for reference: s0.t1.r0.c0',
    )
  })

  it('setText updates textbox paragraph and keeps section/table content unchanged', async () => {
    const filePath = tmpPath('writer-textbox-edit')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({
      paragraphs: ['section para'],
      tables: [{ rows: [['cell text']] }],
      textBoxes: [{ text: 'textbox original' }],
    })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setText', ref: 's0.tb0.p0', text: 'textbox changed' }])

    const doc = await loadHwp(filePath)
    expect(joinRuns(doc.sections[0].textBoxes[0].paragraphs[0].runs)).toBe('textbox changed')
    expect(joinRuns(doc.sections[0].paragraphs[0].runs)).toBe('section para')
    expect(doc.sections[0].tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('cell text')
  })

  it('setText targets textbox by index (tb1 edits second textbox)', async () => {
    const filePath = tmpPath('writer-textbox-index')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({
      textBoxes: [{ text: 'first textbox' }, { text: 'second textbox' }],
    })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setText', ref: 's0.tb1.p0', text: 'second changed' }])

    const doc = await loadHwp(filePath)
    expect(joinRuns(doc.sections[0].textBoxes[0].paragraphs[0].runs)).toBe('first textbox')
    expect(joinRuns(doc.sections[0].textBoxes[1].paragraphs[0].runs)).toBe('second changed')
  })
})

function tmpPath(name: string): string {
  return `/tmp/${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.hwp`
}

function joinRuns(runs: Array<{ text: string }>): string {
  return runs.map((run) => run.text).join('')
}

async function getFileHeader(filePath: string): Promise<Buffer> {
  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const entry = CFB.find(cfb, '/FileHeader')
  if (!entry?.content) {
    throw new Error('FileHeader not found')
  }
  return Buffer.from(entry.content)
}

async function getSectionBuffer(filePath: string, section: number): Promise<Buffer> {
  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const entry = CFB.find(cfb, `/BodyText/Section${section}`)
  if (!entry?.content) {
    throw new Error(`Section stream not found: ${section}`)
  }
  return Buffer.from(entry.content)
}

async function getDocInfoBuffer(filePath: string): Promise<Buffer> {
  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const docInfoEntry = CFB.find(cfb, 'DocInfo')
  if (!docInfoEntry?.content) {
    throw new Error('DocInfo not found')
  }

  const fileHeader = CFB.find(cfb, 'FileHeader')
  if (!fileHeader?.content) {
    throw new Error('FileHeader not found')
  }

  const compressed = getCompressionFlag(Buffer.from(fileHeader.content))
  const docInfo = Buffer.from(docInfoEntry.content)
  return compressed ? decompressStream(docInfo) : docInfo
}

function readIdMappingsCharShapeCount(docInfo: Buffer): number {
  for (const { header, data } of iterateRecords(docInfo)) {
    if (header.tagId === TAG.ID_MAPPINGS) {
      if (data.length < 8) {
        throw new Error('ID_MAPPINGS record too small')
      }
      return data.readUInt32LE(4)
    }
  }

  throw new Error('ID_MAPPINGS record not found')
}

function collectTopLevelParaTextRecords(stream: Buffer): Buffer[] {
  const records: Buffer[] = []
  let paragraphIndex = -1

  for (const { header, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      paragraphIndex += 1
      continue
    }

    if (header.tagId === TAG.PARA_TEXT && header.level === 1 && paragraphIndex >= 0) {
      records[paragraphIndex] = Buffer.from(stream.subarray(offset, offset + header.headerSize + header.size))
    }
  }

  return records
}

function collectCharShapeRecordData(docInfo: Buffer): Buffer[] {
  const records: Buffer[] = []

  for (const { header, data } of iterateRecords(docInfo)) {
    if (header.tagId === TAG.CHAR_SHAPE) {
      records.push(Buffer.from(data))
    }
  }

  return records
}

function readTableCellParaHeaderNChars(stream: Buffer, cellIndex: number): number {
  let cellCursor = -1

  for (const { header, data } of iterateRecords(stream)) {
    if (header.tagId === TAG.LIST_HEADER) {
      cellCursor += 1
      continue
    }

    if (cellCursor === cellIndex && header.tagId === TAG.PARA_HEADER && data.length >= 4) {
      return data.readUInt32LE(0)
    }
  }

  throw new Error(`Table cell ${cellIndex} PARA_HEADER not found`)
}

function readParaHeaderAndTextLength(stream: Buffer, paragraphIndex: number): { nChars: number; textLength: number } {
  let currentPara = -1
  let nChars = -1

  for (const { header, data } of iterateRecords(stream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      currentPara += 1
      if (currentPara === paragraphIndex && data.length >= 4) {
        nChars = data.readUInt32LE(0)
      }
      continue
    }

    if (currentPara === paragraphIndex && header.tagId === TAG.PARA_TEXT) {
      return { nChars, textLength: data.length / 2 }
    }
  }

  throw new Error(`Paragraph ${paragraphIndex} not found`)
}
