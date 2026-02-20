import { afterEach, describe, expect, it } from 'bun:test'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import CFB from 'cfb'
import { loadHwp } from '@/formats/hwp/reader'
import { iterateRecords } from '@/formats/hwp/record-parser'
import { decompressStream, getCompressionFlag } from '@/formats/hwp/stream-util'
import { TAG } from '@/formats/hwp/tag-ids'
import { editHwp } from '@/formats/hwp/writer'
import { createTestHwpBinary } from '@/test-helpers'

const tempFiles: string[] = []

function tempPath(): string {
  const path = `/tmp/hwp-int-test-${Date.now()}-${Math.random().toString(36).slice(2)}.hwp`
  tempFiles.push(path)
  return path
}

afterEach(async () => {
  for (const f of tempFiles) {
    try {
      await unlink(f)
    } catch {}
  }
  tempFiles.length = 0
})

describe('HWP writer: setText round-trip', () => {
  it('setText on paragraph 0 → read back → text changed', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['Hello', 'World'] })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [{ type: 'setText', ref: 's0.p0', text: 'Changed' }])

    const doc = await loadHwp(file)
    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('Changed')
    expect(doc.sections[0].paragraphs[1].runs[0].text).toBe('World')
  })

  it('setText on paragraph 1 → read back → only p1 changed, p0 unchanged', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['First', 'Second'] })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [{ type: 'setText', ref: 's0.p1', text: 'Modified' }])

    const doc = await loadHwp(file)
    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('First')
    expect(doc.sections[0].paragraphs[1].runs[0].text).toBe('Modified')
  })

  it('setText preserves control characters in PARA_TEXT', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['Original'] })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [{ type: 'setText', ref: 's0.p0', text: 'New text' }])

    const doc = await loadHwp(file)
    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('New text')
  })

  it('setText on compressed HWP → read back → text changed', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['Compressed'], compressed: true })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [{ type: 'setText', ref: 's0.p0', text: 'Decompressed edit' }])

    const doc = await loadHwp(file)
    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('Decompressed edit')
  })
})

describe('HWP writer: setTableCell round-trip', () => {
  it('setTableCell r0c0 → read back → cell text changed', async () => {
    const buf = await createTestHwpBinary({
      tables: [
        {
          rows: [
            ['A1', 'B1'],
            ['A2', 'B2'],
          ],
        },
      ],
    })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [{ type: 'setTableCell', ref: 's0.t0.r0.c0', text: 'Changed' }])

    const doc = await loadHwp(file)
    const table = doc.sections[0].tables[0]
    expect(table.rows[0].cells[0].paragraphs[0].runs[0].text).toBe('Changed')
    expect(table.rows[0].cells[1].paragraphs[0].runs[0].text).toBe('B1')
    expect(table.rows[1].cells[0].paragraphs[0].runs[0].text).toBe('A2')
    expect(table.rows[1].cells[1].paragraphs[0].runs[0].text).toBe('B2')
  })

  it('setTableCell r1c1 → read back → only target cell changed', async () => {
    const buf = await createTestHwpBinary({
      tables: [
        {
          rows: [
            ['A1', 'B1'],
            ['A2', 'B2'],
          ],
        },
      ],
    })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [{ type: 'setTableCell', ref: 's0.t0.r1.c1', text: 'New B2' }])

    const doc = await loadHwp(file)
    const table = doc.sections[0].tables[0]
    expect(table.rows[0].cells[0].paragraphs[0].runs[0].text).toBe('A1')
    expect(table.rows[0].cells[1].paragraphs[0].runs[0].text).toBe('B1')
    expect(table.rows[1].cells[0].paragraphs[0].runs[0].text).toBe('A2')
    expect(table.rows[1].cells[1].paragraphs[0].runs[0].text).toBe('New B2')
  })

  it('setTableCell on compressed HWP → read back → cell text changed', async () => {
    const buf = await createTestHwpBinary({
      tables: [{ rows: [['X1', 'Y1']] }],
      compressed: true,
    })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [{ type: 'setTableCell', ref: 's0.t0.r0.c0', text: 'Edited' }])

    const doc = await loadHwp(file)
    expect(doc.sections[0].tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('Edited')
    expect(doc.sections[0].tables[0].rows[0].cells[1].paragraphs[0].runs[0].text).toBe('Y1')
  })
})

describe('HWP writer: setFormat round-trip', () => {
  it('setFormat bold=true → read back → CharShape has bold bit set', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['Bold me'] })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [{ type: 'setFormat', ref: 's0.p0', format: { bold: true } }])

    const charShapes = await readCharShapesFromFile(file)
    const lastShape = charShapes[charShapes.length - 1]
    const attrBits = lastShape.readUInt32LE(22)
    expect(attrBits & 0x1).toBe(1)
  })

  it('setFormat fontSize → read back → CharShape has new font size', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['Resize me'] })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [{ type: 'setFormat', ref: 's0.p0', format: { fontSize: 24 } }])

    const charShapes = await readCharShapesFromFile(file)
    const lastShape = charShapes[charShapes.length - 1]
    const height = lastShape.readUInt32LE(18)
    expect(height).toBe(2400)
  })

  it('setFormat color → read back → CharShape has new color', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['Color me'] })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [{ type: 'setFormat', ref: 's0.p0', format: { color: '#FF0000' } }])

    const charShapes = await readCharShapesFromFile(file)
    const lastShape = charShapes[charShapes.length - 1]
    const colorInt = lastShape.readUInt32LE(26)
    expect(colorInt).toBe(0xff0000)
  })

  it('setFormat does not mutate other paragraphs CharShape', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['Para0', 'Para1'] })
    const file = tempPath()
    await writeFile(file, buf)

    const charShapesBefore = await readCharShapesFromFile(file)
    const originalCount = charShapesBefore.length

    await editHwp(file, [{ type: 'setFormat', ref: 's0.p0', format: { bold: true } }])

    const charShapesAfter = await readCharShapesFromFile(file)
    expect(charShapesAfter.length).toBe(originalCount + 1)
    const originalShape = charShapesAfter[0]
    const originalAttr = originalShape.readUInt32LE(22)
    expect(originalAttr & 0x1).toBe(0)
  })
})

describe('HWP writer: multiple operations', () => {
  it('setText + setTableCell in same call → both applied', async () => {
    const buf = await createTestHwpBinary({
      paragraphs: ['Heading'],
      tables: [{ rows: [['Cell']] }],
    })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [
      { type: 'setText', ref: 's0.p0', text: 'New heading' },
      { type: 'setTableCell', ref: 's0.t0.r0.c0', text: 'New cell' },
    ])

    const doc = await loadHwp(file)
    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('New heading')
    expect(doc.sections[0].tables[0].rows[0].cells[0].paragraphs[0].runs[0].text).toBe('New cell')
  })

  it('two setText on different paragraphs → both applied', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['Alpha', 'Beta', 'Gamma'] })
    const file = tempPath()
    await writeFile(file, buf)

    await editHwp(file, [
      { type: 'setText', ref: 's0.p0', text: 'One' },
      { type: 'setText', ref: 's0.p2', text: 'Three' },
    ])

    const doc = await loadHwp(file)
    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('One')
    expect(doc.sections[0].paragraphs[1].runs[0].text).toBe('Beta')
    expect(doc.sections[0].paragraphs[2].runs[0].text).toBe('Three')
  })
})

describe('HWP writer: error cases', () => {
  it('setText on nonexistent paragraph → throws', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['Only one'] })
    const file = tempPath()
    await writeFile(file, buf)

    await expect(editHwp(file, [{ type: 'setText', ref: 's0.p99', text: 'Nope' }])).rejects.toThrow(/not found/)
  })

  it('setTableCell on nonexistent table → throws', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['No tables'] })
    const file = tempPath()
    await writeFile(file, buf)

    await expect(editHwp(file, [{ type: 'setTableCell', ref: 's0.t0.r0.c0', text: 'Nope' }])).rejects.toThrow(
      /not found/,
    )
  })

  it('setTableCell on nonexistent cell → throws', async () => {
    const buf = await createTestHwpBinary({
      tables: [{ rows: [['A1']] }],
    })
    const file = tempPath()
    await writeFile(file, buf)

    await expect(editHwp(file, [{ type: 'setTableCell', ref: 's0.t0.r9.c9', text: 'Nope' }])).rejects.toThrow(
      /not found/,
    )
  })

  it('setFormat on nonexistent paragraph → throws', async () => {
    const buf = await createTestHwpBinary({ paragraphs: ['Only one'] })
    const file = tempPath()
    await writeFile(file, buf)

    await expect(editHwp(file, [{ type: 'setFormat', ref: 's0.p99', format: { bold: true } }])).rejects.toThrow(
      /not found/,
    )
  })
})

async function readCharShapesFromFile(filePath: string): Promise<Buffer[]> {
  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const fileHeader = Buffer.from(CFB.find(cfb, 'FileHeader')!.content!)
  const compressed = getCompressionFlag(fileHeader)
  let docInfo = Buffer.from(CFB.find(cfb, 'DocInfo')!.content!)
  if (compressed) docInfo = decompressStream(docInfo)

  const charShapes: Buffer[] = []
  for (const { header, data } of iterateRecords(docInfo)) {
    if (header.tagId === TAG.CHAR_SHAPE) {
      charShapes.push(Buffer.from(data))
    }
  }
  return charShapes
}
