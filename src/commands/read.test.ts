import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import CFB from 'cfb'
import { createTestHwpx } from '@/test-helpers'
import { readCommand } from './read'

const TEST_FILE = '/tmp/test-read.hwpx'
const TEST_TABLE_FILE = '/tmp/test-read-table.hwpx'
const TEST_HWP_FILE = '/tmp/test-read.hwp'
const TEST_MANY_PARAGRAPHS_FILE = '/tmp/test-read-many.hwpx'

let logs: string[]
const origLog = console.log
const origError = console.error
const origExit = process.exit

beforeAll(async () => {
  const buffer = await createTestHwpx({ paragraphs: ['Hello', 'World'] })
  await Bun.write(TEST_FILE, buffer)

  const tableBuffer = await createTestHwpx({
    paragraphs: ['Intro'],
    tables: [
      {
        rows: [
          ['A1', 'B1'],
          ['A2', 'B2'],
        ],
      },
    ],
  })
  await Bun.write(TEST_TABLE_FILE, tableBuffer)

  await Bun.write(TEST_HWP_FILE, createMinimalHwp())

  const manyBuffer = await createTestHwpx({
    paragraphs: ['Para0', 'Para1', 'Para2', 'Para3', 'Para4', 'Para5', 'Para6', 'Para7', 'Para8', 'Para9'],
  })
  await Bun.write(TEST_MANY_PARAGRAPHS_FILE, manyBuffer)
})

function captureOutput() {
  logs = []
  console.log = (msg: string) => logs.push(msg)
  console.error = (msg: string) => logs.push(msg)
  process.exit = mock(() => {
    throw new Error('process.exit')
  }) as never
}

function restoreOutput() {
  console.log = origLog
  console.error = origError
  process.exit = origExit
}

afterEach(restoreOutput)

describe('readCommand', () => {
  it('reads full document structure', async () => {
    captureOutput()
    await readCommand(TEST_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.format).toBe('hwpx')
    expect(output.sections).toHaveLength(1)
    expect(output.sections[0].index).toBe(0)
    expect(output.sections[0].paragraphs).toHaveLength(2)
    expect(output.sections[0].paragraphs[0].ref).toBe('s0.p0')
    expect(output.sections[0].paragraphs[0].runs[0].text).toBe('Hello')
    expect(output.sections[0].paragraphs[1].ref).toBe('s0.p1')
    expect(output.sections[0].paragraphs[1].runs[0].text).toBe('World')
    expect(output.header).toBeDefined()
    expect(output.header.fonts).toBeDefined()
    expect(output.header.charShapes).toBeDefined()
  })

  it('reads a single paragraph by ref', async () => {
    captureOutput()
    await readCommand(TEST_FILE, 's0.p0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.p0')
    expect(output.runs[0].text).toBe('Hello')
  })

  it('outputs pretty JSON when --pretty', async () => {
    captureOutput()
    await readCommand(TEST_FILE, undefined, { pretty: true })
    restoreOutput()

    expect(logs[0]).toContain('\n')
    const output = JSON.parse(logs[0])
    expect(output.format).toBe('hwpx')
  })

  it('reads table by ref', async () => {
    captureOutput()
    await readCommand(TEST_TABLE_FILE, 's0.t0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.t0')
    expect(output.rows).toHaveLength(2)
    expect(output.rows[0].cells).toHaveLength(2)
  })

  it('reads table cell by ref', async () => {
    captureOutput()
    await readCommand(TEST_TABLE_FILE, 's0.t0.r0.c0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.t0.r0.c0')
    expect(output.paragraphs[0].runs[0].text).toBe('A1')
  })

  it('errors for nonexistent file', async () => {
    captureOutput()
    await expect(readCommand('/tmp/nonexistent.hwpx', undefined, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.error).toBeDefined()
  })

  it('reads minimal HWP 5.0 file', async () => {
    captureOutput()
    await readCommand(TEST_HWP_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.format).toBe('hwp')
    expect(output.sections).toEqual([])
    expect(output.header).toEqual({
      fonts: [],
      charShapes: [],
      paraShapes: [],
      styles: [],
    })
  })

  it('errors for unsupported format', async () => {
    const unsupportedFile = '/tmp/test-read-unsupported.bin'
    await Bun.write(unsupportedFile, Buffer.from('not a valid hwp or hwpx file'))
    captureOutput()
    await expect(readCommand(unsupportedFile, undefined, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.error).toContain('Unsupported file format')
  })

  it('errors for invalid ref', async () => {
    captureOutput()
    await expect(readCommand(TEST_FILE, 'invalid', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.error).toContain('Invalid reference')
  })

  it('paginates paragraphs with --offset and --limit', async () => {
    captureOutput()
    await readCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { offset: 2, limit: 3 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.totalParagraphs).toBe(10)
    expect(section.totalTables).toBe(0)
    expect(section.totalImages).toBe(0)
    expect(section.paragraphs).toHaveLength(3)
    expect(section.paragraphs[0].runs[0].text).toBe('Para2')
    expect(section.paragraphs[1].runs[0].text).toBe('Para3')
    expect(section.paragraphs[2].runs[0].text).toBe('Para4')
  })

  it('paginates with --limit only', async () => {
    captureOutput()
    await readCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { limit: 2 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.totalParagraphs).toBe(10)
    expect(section.paragraphs).toHaveLength(2)
    expect(section.paragraphs[0].runs[0].text).toBe('Para0')
    expect(section.paragraphs[1].runs[0].text).toBe('Para1')
  })

  it('paginates with --offset only', async () => {
    captureOutput()
    await readCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { offset: 8 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.totalParagraphs).toBe(10)
    expect(section.paragraphs).toHaveLength(2)
    expect(section.paragraphs[0].runs[0].text).toBe('Para8')
    expect(section.paragraphs[1].runs[0].text).toBe('Para9')
  })

  it('returns empty paragraphs when offset exceeds count', async () => {
    captureOutput()
    await readCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { offset: 100 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.totalParagraphs).toBe(10)
    expect(section.paragraphs).toHaveLength(0)
  })

  it('does not include totals without pagination options', async () => {
    captureOutput()
    await readCommand(TEST_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    const section = output.sections[0]
    expect(section.totalParagraphs).toBeUndefined()
    expect(section.totalTables).toBeUndefined()
    expect(section.totalImages).toBeUndefined()
  })

  it('ignores pagination when ref is provided', async () => {
    captureOutput()
    await readCommand(TEST_FILE, 's0.p0', { offset: 5, limit: 10 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.p0')
    expect(output.runs[0].text).toBe('Hello')
  })
})

function createMinimalHwp(): Buffer {
  const cfb = CFB.utils.cfb_new()
  const fileHeader = Buffer.alloc(256)
  fileHeader.write('HWP Document File', 0, 'ascii')
  fileHeader.writeUInt32LE(0, 36)

  CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
  CFB.utils.cfb_add(cfb, 'DocInfo', Buffer.alloc(0))

  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}
