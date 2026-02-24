import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { createTestHwpBinary, createTestHwpx } from '@/test-helpers'
import { textCommand } from './text'

const TEST_FILE = '/tmp/test-text.hwpx'
const TEST_TABLE_FILE = '/tmp/test-text-table.hwpx'
const TEST_HWP_FILE = '/tmp/test-text.hwp'
const TEST_HWP_TABLE_FILE = '/tmp/test-text-table.hwp'
const TEST_MANY_PARAGRAPHS_FILE = '/tmp/test-text-many.hwpx'
const TEST_HWP_MANY_FILE = '/tmp/test-text-many.hwp'

let logs: string[]
const origLog = console.log
const origError = console.error
const origExit = process.exit

beforeAll(async () => {
  process.env.HWPILOT_NO_DAEMON = '1'

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

  const hwpBuffer = await createTestHwpBinary({ paragraphs: ['Hello', 'World'] })
  await Bun.write(TEST_HWP_FILE, hwpBuffer)

  const hwpTableBuffer = await createTestHwpBinary({
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
  await Bun.write(TEST_HWP_TABLE_FILE, hwpTableBuffer)

  const manyParagraphs = ['Para0', 'Para1', 'Para2', 'Para3', 'Para4', 'Para5', 'Para6', 'Para7', 'Para8', 'Para9']
  const manyBuffer = await createTestHwpx({ paragraphs: manyParagraphs })
  await Bun.write(TEST_MANY_PARAGRAPHS_FILE, manyBuffer)

  const manyHwpBuffer = await createTestHwpBinary({ paragraphs: manyParagraphs })
  await Bun.write(TEST_HWP_MANY_FILE, manyHwpBuffer)
})

afterAll(() => {
  delete process.env.HWPILOT_NO_DAEMON
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

describe('textCommand', () => {
  it('extracts all text from document', async () => {
    captureOutput()
    await textCommand(TEST_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.text).toBe('Hello\nWorld')
  })

  it('extracts text from a specific paragraph', async () => {
    captureOutput()
    await textCommand(TEST_FILE, 's0.p1', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.p1')
    expect(output.text).toBe('World')
  })

  it('extracts text from first paragraph', async () => {
    captureOutput()
    await textCommand(TEST_FILE, 's0.p0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.p0')
    expect(output.text).toBe('Hello')
  })

  it('extracts text from table cell', async () => {
    captureOutput()
    await textCommand(TEST_TABLE_FILE, 's0.t0.r0.c0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.t0.r0.c0')
    expect(output.text).toBe('A1')
  })

  it('extracts text from entire table', async () => {
    captureOutput()
    await textCommand(TEST_TABLE_FILE, 's0.t0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.t0')
    expect(output.text).toContain('A1')
    expect(output.text).toContain('B1')
    expect(output.text).toContain('A2')
    expect(output.text).toContain('B2')
  })

  it('includes table text in full extraction', async () => {
    captureOutput()
    await textCommand(TEST_TABLE_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.text).toContain('Intro')
    expect(output.text).toContain('A1')
  })

  it('outputs pretty JSON when --pretty', async () => {
    captureOutput()
    await textCommand(TEST_FILE, undefined, { pretty: true })
    restoreOutput()

    expect(logs[0]).toContain('\n')
    const output = JSON.parse(logs[0])
    expect(output.text).toBe('Hello\nWorld')
  })

  it('extracts all text from HWP document', async () => {
    captureOutput()
    await textCommand(TEST_HWP_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.text).toBe('Hello\nWorld')
  })

  it('extracts text from specific paragraph in HWP', async () => {
    captureOutput()
    await textCommand(TEST_HWP_FILE, 's0.p1', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.p1')
    expect(output.text).toBe('World')
  })

  it('extracts text from HWP table cell', async () => {
    captureOutput()
    await textCommand(TEST_HWP_TABLE_FILE, 's0.t0.r0.c0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.t0.r0.c0')
    expect(output.text).toBe('A1')
  })

  it('includes table text in full HWP extraction', async () => {
    captureOutput()
    await textCommand(TEST_HWP_TABLE_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.text).toContain('Intro')
    expect(output.text).toContain('A1')
  })

  it('errors for nonexistent file', async () => {
    captureOutput()
    await expect(textCommand('/tmp/nonexistent.hwpx', undefined, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.error).toBeDefined()
  })

  it('errors for invalid ref', async () => {
    captureOutput()
    await expect(textCommand(TEST_FILE, 'badref', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.error).toContain('Invalid reference')
  })

  it('paginates text with --offset and --limit', async () => {
    captureOutput()
    await textCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { offset: 3, limit: 4 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.text).toBe('Para3\nPara4\nPara5\nPara6')
    expect(output.totalParagraphs).toBe(10)
    expect(output.offset).toBe(3)
    expect(output.count).toBe(4)
  })

  it('paginates text with --limit only', async () => {
    captureOutput()
    await textCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { limit: 3 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.text).toBe('Para0\nPara1\nPara2')
    expect(output.totalParagraphs).toBe(10)
    expect(output.count).toBe(3)
  })

  it('paginates text with --offset only', async () => {
    captureOutput()
    await textCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { offset: 7 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.text).toBe('Para7\nPara8\nPara9')
    expect(output.totalParagraphs).toBe(10)
    expect(output.offset).toBe(7)
    expect(output.count).toBe(3)
  })

  it('paginates HWP text with --offset and --limit', async () => {
    captureOutput()
    await textCommand(TEST_HWP_MANY_FILE, undefined, { offset: 2, limit: 3 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.text).toBe('Para2\nPara3\nPara4')
    expect(output.totalParagraphs).toBe(10)
    expect(output.offset).toBe(2)
    expect(output.count).toBe(3)
  })

  it('returns empty text when offset exceeds paragraph count', async () => {
    captureOutput()
    await textCommand(TEST_MANY_PARAGRAPHS_FILE, undefined, { offset: 100 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.text).toBe('')
    expect(output.totalParagraphs).toBe(10)
    expect(output.count).toBe(0)
  })
})

describe('textCommand — text box support', () => {
  const TEST_TB_FILE = '/tmp/test-text-textbox.hwpx'
  const TEST_TB_HWP_FILE = '/tmp/test-text-textbox.hwp'

  beforeAll(async () => {
    const buffer = await createTestHwpx({
      paragraphs: ['Normal'],
      textBoxes: [{ text: 'Box text' }],
    })
    await Bun.write(TEST_TB_FILE, buffer)

    const hwpBuffer = await createTestHwpBinary({
      paragraphs: ['Normal'],
      textBoxes: [{ text: 'Box text' }],
    })
    await Bun.write(TEST_TB_HWP_FILE, hwpBuffer)
  })

  it('extracts text from text box ref s0.tb0', async () => {
    captureOutput()
    await textCommand(TEST_TB_FILE, 's0.tb0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.tb0')
    expect(output.text).toBe('Box text')
  })

  it('extracts text from text box paragraph ref s0.tb0.p0', async () => {
    captureOutput()
    await textCommand(TEST_TB_FILE, 's0.tb0.p0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.tb0.p0')
    expect(output.text).toBe('Box text')
  })

  it('includes text box text in full extraction', async () => {
    captureOutput()
    await textCommand(TEST_TB_FILE, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.text).toContain('Normal')
    expect(output.text).toContain('Box text')
  })

  it('extracts text from HWP text box ref', async () => {
    captureOutput()
    await textCommand(TEST_TB_HWP_FILE, 's0.tb0.p0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.tb0.p0')
    expect(output.text).toBe('Box text')
  })

  it('errors for nonexistent text box', async () => {
    captureOutput()
    await expect(textCommand(TEST_TB_FILE, 's0.tb5', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.error).toContain('not found')
  })

  it('errors for text from image ref', async () => {
    captureOutput()
    await expect(textCommand(TEST_TB_FILE, 's0.img0', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.error).toContain('image')
  })
})
