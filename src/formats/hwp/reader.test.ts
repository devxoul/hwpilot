import { afterEach, describe, expect, it } from 'bun:test'
import CFB from 'cfb'
import { buildCellListHeaderData, buildMergedTable } from '../../test-helpers'
import { controlIdBuffer } from './control-id'
import { extractParaText, loadHwp } from './reader'
import { buildRecord } from './record-serializer'
import { TAG } from './tag-ids'

const TMP_FILES: string[] = []

afterEach(async () => {
  await Promise.all(
    TMP_FILES.splice(0).map(async (file) => {
      await Bun.file(file).delete()
    }),
  )
})

describe('loadHwp', () => {
  it('throws for invalid signature', async () => {
    const filePath = '/tmp/test-invalid-signature.hwp'
    TMP_FILES.push(filePath)
    const buffer = createHwpCfbBuffer(0, 'Not HWP Signature')
    await Bun.write(filePath, buffer)

    await expect(loadHwp(filePath)).rejects.toThrow('Invalid HWP file: wrong signature')
  })

  it('throws for encrypted files', async () => {
    const filePath = '/tmp/test-encrypted.hwp'
    TMP_FILES.push(filePath)
    const buffer = createHwpCfbBuffer(0x2, 'HWP Document File')
    await Bun.write(filePath, buffer)

    await expect(loadHwp(filePath)).rejects.toThrow('Password-protected files not supported')
  })

  it('exports expected public functions', () => {
    expect(typeof loadHwp).toBe('function')
    expect(typeof extractParaText).toBe('function')
  })

  it('parses 2x2 table cells and keeps table cell paragraphs out of section paragraphs', async () => {
    const filePath = '/tmp/test-hwp-table.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([
      paragraphRecord(0, 'Before table'),
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x000b, 0x0000])),
      buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('tbl ')),
      buildRecord(TAG.TABLE, 2, tableData(2, 2)),
      cellRecord(2, 'A1', 0, 0),
      cellRecord(2, 'A2', 1, 0),
      cellRecord(2, 'B1', 0, 1),
      cellRecord(2, 'B2', 1, 1),
      paragraphRecord(0, 'After table'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const section = doc.sections[0]

    expect(section.tables).toHaveLength(1)
    expect(section.tables[0].rows).toHaveLength(2)
    expect(section.tables[0].rows[0].cells).toHaveLength(2)
    expect(section.tables[0].rows[1].cells).toHaveLength(2)
    expect(section.tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('A1')
    expect(section.tables[0].rows[0].cells[1].paragraphs[0].runs[0].text).toBe('A2')
    expect(section.tables[0].rows[1].cells[0].paragraphs[0].runs[0].text).toBe('B1')
    expect(section.tables[0].rows[1].cells[1].paragraphs[0].runs[0].text).toBe('B2')

    const paragraphTexts = section.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    expect(paragraphTexts).toContain('Before table')
    expect(paragraphTexts).toContain('After table')
    expect(paragraphTexts).not.toContain('A1')
    expect(paragraphTexts).not.toContain('A2')
    expect(paragraphTexts).not.toContain('B1')
    expect(paragraphTexts).not.toContain('B2')
  })

  it('assigns correct cell refs when PARA_HEADER is at same level as LIST_HEADER', async () => {
    const filePath = '/tmp/test-hwp-table-same-level-para.hwp'
    TMP_FILES.push(filePath)

    // Real HWP files have PARA_HEADER at the same level as LIST_HEADER,
    // not level+1 like the cellRecord helper creates.
    const sameLevelCellRecord = (level: number, text: string, col: number, row: number): Buffer =>
      Buffer.concat([
        buildRecord(TAG.LIST_HEADER, level, buildCellListHeaderData(col, row)),
        paragraphRecord(level, text),
      ])

    const sectionRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x000b, 0x0000])),
      buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('tbl ')),
      buildRecord(TAG.TABLE, 2, tableData(2, 2)),
      sameLevelCellRecord(2, 'A1', 0, 0),
      sameLevelCellRecord(2, 'A2', 1, 0),
      sameLevelCellRecord(2, 'B1', 0, 1),
      sameLevelCellRecord(2, 'B2', 1, 1),
      paragraphRecord(0, 'After table'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const table = doc.sections[0].tables[0]

    expect(table.rows[0].cells[0].ref).toBe('s0.t0.r0.c0')
    expect(table.rows[0].cells[0].paragraphs[0].runs[0].text).toBe('A1')
    expect(table.rows[0].cells[1].ref).toBe('s0.t0.r0.c1')
    expect(table.rows[0].cells[1].paragraphs[0].runs[0].text).toBe('A2')
    expect(table.rows[1].cells[0].ref).toBe('s0.t0.r1.c0')
    expect(table.rows[1].cells[0].paragraphs[0].runs[0].text).toBe('B1')
    expect(table.rows[1].cells[1].ref).toBe('s0.t0.r1.c1')
    expect(table.rows[1].cells[1].paragraphs[0].runs[0].text).toBe('B2')
  })

  it('parses merged cell with colSpan from LIST_HEADER data', async () => {
    const filePath = '/tmp/test-hwp-table-merged-colspan.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([
      buildMergedTable(
        [
          [
            { text: 'A1-A2', col: 0, row: 0, colSpan: 2, rowSpan: 1 },
            { text: 'A3', col: 2, row: 0, colSpan: 1, rowSpan: 1 },
          ],
        ],
        3,
        1,
      ),
      paragraphRecord(0, 'After merged table'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const row = doc.sections[0].tables[0].rows[0]

    expect(row.cells).toHaveLength(2)
    expect(row.cells[0].colSpan).toBe(2)
    expect(row.cells[0].ref).toBe('s0.t0.r0.c0')
    expect(row.cells[1].colSpan).toBe(1)
    expect(row.cells[1].ref).toBe('s0.t0.r0.c2')
  })

  it('falls back to sequential cell addressing when LIST_HEADER data is empty', async () => {
    const filePath = '/tmp/test-hwp-table-empty-list-header.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x000b, 0x0000])),
      buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('tbl ')),
      buildRecord(TAG.TABLE, 2, tableData(1, 3)),
      buildRecord(TAG.LIST_HEADER, 2, Buffer.alloc(0)),
      paragraphRecord(3, 'A1'),
      buildRecord(TAG.LIST_HEADER, 2, Buffer.alloc(0)),
      paragraphRecord(3, 'A2'),
      buildRecord(TAG.LIST_HEADER, 2, Buffer.alloc(0)),
      paragraphRecord(3, 'A3'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const cells = doc.sections[0].tables[0].rows[0].cells

    expect(cells).toHaveLength(3)
    expect(cells[0].ref).toBe('s0.t0.r0.c0')
    expect(cells[1].ref).toBe('s0.t0.r0.c1')
    expect(cells[2].ref).toBe('s0.t0.r0.c2')
  })

  it('populates colSpan and rowSpan from LIST_HEADER', async () => {
    const filePath = '/tmp/test-hwp-table-colspan-rowspan.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([
      buildMergedTable([[{ text: 'Merged', col: 0, row: 0, colSpan: 3, rowSpan: 2 }]], 3, 2),
      paragraphRecord(0, 'After table'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const cell = doc.sections[0].tables[0].rows[0].cells[0]

    expect(cell.colSpan).toBe(3)
    expect(cell.rowSpan).toBe(2)
  })

  it('completes table parsing by level even when merged cells reduce LIST_HEADER count', async () => {
    const filePath = '/tmp/test-hwp-table-completion-merged.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([
      buildMergedTable(
        [
          [{ text: 'Top merged', col: 0, row: 0, colSpan: 2, rowSpan: 1 }],
          [{ text: 'Bottom merged', col: 0, row: 1, colSpan: 2, rowSpan: 1 }],
        ],
        2,
        2,
      ),
      paragraphRecord(0, 'After merged table'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const section = doc.sections[0]

    expect(section.tables).toHaveLength(1)
    expect(section.tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('Top merged')
    expect(section.tables[0].rows[1].cells[0].paragraphs[0].runs[0].text).toBe('Bottom merged')
    const paragraphTexts = section.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    expect(paragraphTexts).toContain('After merged table')
    expect(paragraphTexts).not.toContain('Top merged')
    expect(paragraphTexts).not.toContain('Bottom merged')
  })

  it('returns empty table list when no tbl control exists', async () => {
    const filePath = '/tmp/test-hwp-no-table-controls.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([
      paragraphRecord(0, 'Line 1'),
      buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('gso ')),
      paragraphRecord(0, 'Line 2'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const section = doc.sections[0]

    expect(section.tables).toEqual([])
    expect(section.paragraphs).toHaveLength(2)
  })

  it('parses text box paragraphs from gso rectangle shape and excludes them from section paragraphs', async () => {
    const filePath = '/tmp/test-hwp-textbox-single.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([
      paragraphRecord(0, 'Before text box'),
      buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('gso ')),
      buildRecord(TAG.SHAPE_COMPONENT, 2, shapeComponentSubtypeData('$rec', 200, 80)),
      buildRecord(TAG.SHAPE_COMPONENT_RECTANGLE, 3, Buffer.alloc(0)),
      buildRecord(TAG.LIST_HEADER, 2, Buffer.alloc(0)),
      paragraphRecord(3, 'Inside textbox'),
      paragraphRecord(0, 'After text box'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const section = doc.sections[0]

    expect(section.textBoxes).toHaveLength(1)
    expect(section.textBoxes[0].ref).toBe('s0.tb0')
    expect(section.textBoxes[0].paragraphs).toHaveLength(1)
    expect(section.textBoxes[0].paragraphs[0].ref).toBe('s0.tb0.p0')
    expect(section.textBoxes[0].paragraphs[0].runs[0].text).toBe('Inside textbox')

    const paragraphTexts = section.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    expect(paragraphTexts).toContain('Before text box')
    expect(paragraphTexts).toContain('After text box')
    expect(paragraphTexts).not.toContain('Inside textbox')
  })

  it('assigns sequential refs for multiple text boxes', async () => {
    const filePath = '/tmp/test-hwp-textbox-multiple.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([
      buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('gso ')),
      buildRecord(TAG.SHAPE_COMPONENT, 2, shapeComponentSubtypeData('$rec', 120, 60)),
      buildRecord(TAG.SHAPE_COMPONENT_RECTANGLE, 3, Buffer.alloc(0)),
      buildRecord(TAG.LIST_HEADER, 2, Buffer.alloc(0)),
      paragraphRecord(3, 'TB-1'),
      buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('gso ')),
      buildRecord(TAG.SHAPE_COMPONENT, 2, shapeComponentSubtypeData('$rec', 140, 70)),
      buildRecord(TAG.SHAPE_COMPONENT_RECTANGLE, 3, Buffer.alloc(0)),
      buildRecord(TAG.LIST_HEADER, 2, Buffer.alloc(0)),
      paragraphRecord(3, 'TB-2'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const section = doc.sections[0]

    expect(section.textBoxes).toHaveLength(2)
    expect(section.textBoxes[0].ref).toBe('s0.tb0')
    expect(section.textBoxes[1].ref).toBe('s0.tb1')
    expect(section.textBoxes[0].paragraphs[0].ref).toBe('s0.tb0.p0')
    expect(section.textBoxes[1].paragraphs[0].ref).toBe('s0.tb1.p0')
    expect(section.textBoxes[0].paragraphs[0].runs[0].text).toBe('TB-1')
    expect(section.textBoxes[1].paragraphs[0].runs[0].text).toBe('TB-2')
  })

  it('creates empty text box when list header has no paragraphs', async () => {
    const filePath = '/tmp/test-hwp-textbox-empty.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([
      buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('gso ')),
      buildRecord(TAG.SHAPE_COMPONENT, 2, shapeComponentSubtypeData('$rec', 100, 50)),
      buildRecord(TAG.SHAPE_COMPONENT_RECTANGLE, 3, Buffer.alloc(0)),
      buildRecord(TAG.LIST_HEADER, 2, Buffer.alloc(0)),
      paragraphRecord(0, 'After empty textbox'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const section = doc.sections[0]

    expect(section.textBoxes).toHaveLength(1)
    expect(section.textBoxes[0].ref).toBe('s0.tb0')
    expect(section.textBoxes[0].paragraphs).toEqual([])
    expect(section.paragraphs[0].runs[0].text).toBe('After empty textbox')
  })

  it('parses text box that appears after a table without regressing table parsing', async () => {
    const filePath = '/tmp/test-hwp-table-then-textbox.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([
      paragraphRecord(0, 'Before table'),
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x000b, 0x0000])),
      buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('tbl ')),
      buildRecord(TAG.TABLE, 2, tableData(1, 1)),
      cellRecord(2, 'CELL'),
      buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('gso ')),
      buildRecord(TAG.SHAPE_COMPONENT, 2, shapeComponentSubtypeData('$rec', 180, 90)),
      buildRecord(TAG.SHAPE_COMPONENT_RECTANGLE, 3, Buffer.alloc(0)),
      buildRecord(TAG.LIST_HEADER, 2, Buffer.alloc(0)),
      paragraphRecord(3, 'TB-AFTER-TABLE'),
      paragraphRecord(0, 'After textbox'),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const section = doc.sections[0]

    expect(section.tables).toHaveLength(1)
    expect(section.tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('CELL')

    expect(section.textBoxes).toHaveLength(1)
    expect(section.textBoxes[0].ref).toBe('s0.tb0')
    expect(section.textBoxes[0].paragraphs[0].runs[0].text).toBe('TB-AFTER-TABLE')

    const paragraphTexts = section.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    expect(paragraphTexts).toContain('Before table')
    expect(paragraphTexts).toContain('After textbox')
    expect(paragraphTexts).not.toContain('CELL')
    expect(paragraphTexts).not.toContain('TB-AFTER-TABLE')
  })

  it('parses paraShapeRef and styleRef from PARA_HEADER record data', async () => {
    const filePath = '/tmp/test-hwp-para-shape-ref.hwp'
    TMP_FILES.push(filePath)

    const paraHeaderData = Buffer.alloc(12)
    paraHeaderData.writeUInt32LE(5, 0)
    paraHeaderData.writeUInt32LE(0, 4)
    paraHeaderData.writeUInt16LE(2, 8)
    paraHeaderData.writeUInt8(1, 10)

    const sectionRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, paraHeaderData),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x0041, 0x0000])),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const paragraph = doc.sections[0].paragraphs[0]

    expect(paragraph.paraShapeRef).toBe(2)
    expect(paragraph.styleRef).toBe(1)
  })

  it('parses image records using DocInfo BIN_DATA and shape records', async () => {
    const filePath = '/tmp/test-hwp-image.hwp'
    TMP_FILES.push(filePath)

    const docInfoRecords = buildRecord(TAG.BIN_DATA, 0, binDataRecord(1, 'png'))
    const sectionRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.SHAPE_COMPONENT, 1, shapeComponentData(320, 240)),
      buildRecord(TAG.SHAPE_COMPONENT_PICTURE, 2, shapePictureData(1)),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, docInfoRecords, sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const image = doc.sections[0].images[0]

    expect(doc.sections[0].images).toHaveLength(1)
    expect(image.ref).toBe('s0.img0')
    expect(image.binDataPath).toBe('BinData/image1.png')
    expect(image.width).toBe(320)
    expect(image.height).toBe(240)
    expect(image.format).toBe('png')
  })
})

describe('PARA_CHAR_SHAPE reading', () => {
  function paraCharShapeData(...entries: Array<{ pos: number; ref: number }>): Buffer {
    const buf = Buffer.alloc(entries.length * 8)
    for (let i = 0; i < entries.length; i++) {
      buf.writeUInt32LE(entries[i].pos, i * 8)
      buf.writeUInt32LE(entries[i].ref, i * 8 + 4)
    }
    return buf
  }

  function paragraphWithCharShape(
    level: number,
    text: string,
    charShapeEntries: Array<{ pos: number; ref: number }>,
  ): Buffer {
    // Real HWP record order: PARA_HEADER, PARA_TEXT, PARA_CHAR_SHAPE, PARA_LINE_SEG
    return Buffer.concat([
      buildRecord(TAG.PARA_HEADER, level, Buffer.alloc(0)),
      buildRecord(TAG.PARA_TEXT, level + 1, encodeUint16([...text].map((ch) => ch.charCodeAt(0)).concat(0x0000))),
      buildRecord(TAG.PARA_CHAR_SHAPE, level + 1, paraCharShapeData(...charShapeEntries)),
    ])
  }

  it('reads charShapeRef when PARA_TEXT appears before PARA_CHAR_SHAPE', async () => {
    const filePath = '/tmp/test-hwp-charshape-ordering.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([paragraphWithCharShape(0, 'Hello', [{ pos: 0, ref: 5 }])])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const run = doc.sections[0].paragraphs[0].runs[0]

    expect(run.charShapeRef).toBe(5)
  })

  it('reads charShapeRef when PARA_CHAR_SHAPE appears before PARA_TEXT', async () => {
    const filePath = '/tmp/test-hwp-charshape-before-text.hwp'
    TMP_FILES.push(filePath)

    // Reversed order: PARA_HEADER, PARA_CHAR_SHAPE, PARA_TEXT
    const sectionRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.PARA_CHAR_SHAPE, 1, paraCharShapeData({ pos: 0, ref: 3 })),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([...'World'].map((ch) => ch.charCodeAt(0)).concat(0x0000))),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const run = doc.sections[0].paragraphs[0].runs[0]

    expect(run.charShapeRef).toBe(3)
  })

  it('splits text into multiple runs for inline formatting', async () => {
    const filePath = '/tmp/test-hwp-charshape-inline.hwp'
    TMP_FILES.push(filePath)

    // 'Hello World' with two charShape entries: pos 0 ref 1, pos 5 ref 2
    const sectionRecords = Buffer.concat([
      paragraphWithCharShape(0, 'Hello World', [
        { pos: 0, ref: 1 },
        { pos: 5, ref: 2 },
      ]),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const runs = doc.sections[0].paragraphs[0].runs

    expect(runs).toHaveLength(2)
    expect(runs[0].text).toBe('Hello')
    expect(runs[0].charShapeRef).toBe(1)
    expect(runs[1].text).toBe(' World')
    expect(runs[1].charShapeRef).toBe(2)
  })

  it('handles large charShapeRef values exceeding uint16 range', async () => {
    const filePath = '/tmp/test-hwp-charshape-large-ref.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = Buffer.concat([paragraphWithCharShape(0, 'Test', [{ pos: 0, ref: 70000 }])])

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const run = doc.sections[0].paragraphs[0].runs[0]

    expect(run.charShapeRef).toBe(70000)
  })

  it('defaults to charShapeRef 0 when no PARA_CHAR_SHAPE record exists', async () => {
    const filePath = '/tmp/test-hwp-charshape-missing.hwp'
    TMP_FILES.push(filePath)

    const sectionRecords = paragraphRecord(0, 'No charshape')

    const buffer = createHwpCfbBufferWithRecords(0, Buffer.alloc(0), sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const run = doc.sections[0].paragraphs[0].runs[0]

    expect(run.charShapeRef).toBe(0)
  })
})

describe('extractParaText', () => {
  it('extracts UTF-16LE text and skips inline control payload', () => {
    const data = encodeUint16([
      0x0041, 0x0001, 0x1111, 0x2222, 0x3333, 0x4444, 0x5555, 0x6666, 0x7777, 0x0042, 0x0009, 0x0043, 0x0000,
    ])

    expect(extractParaText(data)).toBe('ABC')
  })
})

function createHwpCfbBuffer(flags: number, signature: string): Buffer {
  const cfb = CFB.utils.cfb_new()
  const fileHeader = Buffer.alloc(256)
  fileHeader.write(signature, 0, 'ascii')
  fileHeader.writeUInt32LE(flags, 36)

  CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
  CFB.utils.cfb_add(cfb, 'DocInfo', Buffer.alloc(0))

  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}

function createHwpCfbBufferWithRecords(flags: number, docInfo: Buffer, section0: Buffer): Buffer {
  const cfb = CFB.utils.cfb_new()
  const fileHeader = Buffer.alloc(256)
  fileHeader.write('HWP Document File', 0, 'ascii')
  fileHeader.writeUInt32LE(flags, 36)

  CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
  CFB.utils.cfb_add(cfb, 'DocInfo', docInfo)
  CFB.utils.cfb_add(cfb, '/BodyText/Section0', section0)

  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}

function encodeUint16(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2)
  for (const [index, value] of values.entries()) {
    buffer.writeUInt16LE(value, index * 2)
  }
  return buffer
}

function encodeUtf16le(text: string): Buffer {
  const utf16 = Buffer.from(text, 'utf16le')
  const length = Buffer.alloc(2)
  length.writeUInt16LE(text.length, 0)
  return Buffer.concat([length, utf16])
}

function paragraphRecord(level: number, text: string): Buffer {
  return Buffer.concat([
    buildRecord(TAG.PARA_HEADER, level, Buffer.alloc(0)),
    buildRecord(TAG.PARA_TEXT, level + 1, encodeUint16([...text].map((ch) => ch.charCodeAt(0)).concat(0x0000))),
  ])
}

function tableData(rows: number, cols: number): Buffer {
  const data = Buffer.alloc(8)
  data.writeUInt16LE(rows, 4)
  data.writeUInt16LE(cols, 6)
  return data
}

function cellRecord(level: number, text: string, col = 0, row = 0, colSpan = 1, rowSpan = 1): Buffer {
  return Buffer.concat([
    buildRecord(TAG.LIST_HEADER, level, buildCellListHeaderData(col, row, colSpan, rowSpan)),
    paragraphRecord(level + 1, text),
  ])
}

function binDataRecord(binId: number, extension: string): Buffer {
  const flags = Buffer.alloc(2)
  flags.writeUInt16LE(1, 0)

  const id = Buffer.alloc(2)
  id.writeUInt16LE(binId, 0)

  return Buffer.concat([flags, id, encodeUtf16le(extension)])
}

function shapeComponentData(width: number, height: number): Buffer {
  const data = Buffer.alloc(32)
  data.writeUInt32LE(0x24706963, 0)
  data.writeUInt32LE(0x24706963, 4)
  data.writeInt32LE(width, 20)
  data.writeInt32LE(height, 24)
  return data
}

function shapeComponentSubtypeData(subtype: '$pic' | '$rec', width: number, height: number): Buffer {
  const data = Buffer.alloc(32)
  const idBytes = controlIdBuffer(subtype)
  idBytes.copy(data, 0)
  idBytes.copy(data, 4)
  data.writeInt32LE(width, 20)
  data.writeInt32LE(height, 24)
  return data
}

function shapePictureData(binId: number, noiseIdAtZero = 0): Buffer {
  const data = Buffer.alloc(4 * 17 + 5)
  if (noiseIdAtZero > 0) {
    data.writeUInt16LE(noiseIdAtZero, 0)
  }
  data.writeUInt16LE(binId, 4 * 17 + 3)
  return data
}

// Test for STYLE record with non-empty English name
describe('STYLE record parsing', () => {
  it('parses STYLE record with non-empty English name correctly', async () => {
    const filePath = '/tmp/test-hwp-style-english-name.hwp'
    const _TMP_FILES: string[] = [filePath]

    // Build STYLE record with Korean name "스타일" and English name "Heading 1"
    const koreanName = Buffer.from('스타일', 'utf16le')
    const koreanNameLen = Buffer.alloc(2)
    koreanNameLen.writeUInt16LE(3, 0) // "스타일" is 3 characters

    const englishName = Buffer.from('Heading 1', 'utf16le')
    const englishNameLen = Buffer.alloc(2)
    englishNameLen.writeUInt16LE(9, 0) // "Heading 1" is 9 characters

    const charShapeRef = Buffer.alloc(2)
    charShapeRef.writeUInt16LE(5, 0)

    const paraShapeRef = Buffer.alloc(2)
    paraShapeRef.writeUInt16LE(3, 0)

    const styleData = Buffer.concat([
      koreanNameLen,
      koreanName,
      englishNameLen,
      englishName,
      charShapeRef,
      paraShapeRef,
    ])

    const docInfoRecords = buildRecord(TAG.STYLE, 1, styleData)
    const sectionRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x0000])),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, docInfoRecords, sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const style = doc.header.styles[0]

    expect(style.name).toBe('스타일')
    expect(style.charShapeRef).toBe(5)
    expect(style.paraShapeRef).toBe(3)

    // Cleanup
    await Bun.file(filePath).delete()
  })
})

// Test for PARA_SHAPE record with heading level
describe('PARA_SHAPE record parsing', () => {
  it('parses PARA_SHAPE with heading level 1 set in bits 25-27', async () => {
    const filePath = '/tmp/test-hwp-para-shape-heading-1.hwp'
    const _TMP_FILES: string[] = [filePath]

    // Build PARA_SHAPE record with heading level 1 in bits 25-27
    // First DWORD: bits 25-27 = 1 (heading level 1)
    // Bits 25-27 means: (1 << 25) = 0x02000000
    const dword = Buffer.alloc(4)
    dword.writeUInt32LE(0x02000000, 0) // heading level 1 in bits 25-27

    const paraShapeData = dword

    const docInfoRecords = buildRecord(TAG.PARA_SHAPE, 1, paraShapeData)
    const sectionRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x0000])),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, docInfoRecords, sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const paraShape = doc.header.paraShapes[0]

    expect(paraShape.headingLevel).toBe(1)

    // Cleanup
    await Bun.file(filePath).delete()
  })

  it('parses PARA_SHAPE with heading level 0 (body text) as undefined', async () => {
    const filePath = '/tmp/test-hwp-para-shape-heading-0.hwp'
    const _TMP_FILES: string[] = [filePath]

    // Build PARA_SHAPE record with heading level 0 (body text)
    const dword = Buffer.alloc(4)
    dword.writeUInt32LE(0x00000000, 0) // heading level 0 (body text)

    const paraShapeData = dword

    const docInfoRecords = buildRecord(TAG.PARA_SHAPE, 1, paraShapeData)
    const sectionRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x0000])),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, docInfoRecords, sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const paraShape = doc.header.paraShapes[0]

    expect(paraShape.headingLevel).toBeUndefined()

    // Cleanup
    await Bun.file(filePath).delete()
  })

  it('parses PARA_SHAPE with heading level 3 set in bits 25-27', async () => {
    const filePath = '/tmp/test-hwp-para-shape-heading-3.hwp'
    const _TMP_FILES: string[] = [filePath]

    // Build PARA_SHAPE record with heading level 3 in bits 25-27
    // Bits 25-27 = 3 means: (3 << 25) = 0x06000000
    const dword = Buffer.alloc(4)
    dword.writeUInt32LE(0x06000000, 0) // heading level 3 in bits 25-27

    const paraShapeData = dword

    const docInfoRecords = buildRecord(TAG.PARA_SHAPE, 1, paraShapeData)
    const sectionRecords = Buffer.concat([
      buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(0)),
      buildRecord(TAG.PARA_TEXT, 1, encodeUint16([0x0000])),
    ])

    const buffer = createHwpCfbBufferWithRecords(0, docInfoRecords, sectionRecords)
    await Bun.write(filePath, buffer)

    const doc = await loadHwp(filePath)
    const paraShape = doc.header.paraShapes[0]

    expect(paraShape.headingLevel).toBe(3)

    // Cleanup
    await Bun.file(filePath).delete()
  })
})
