import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { createTestHwpBinary, createTestHwpx } from '@/test-helpers'
import { textCommand } from './text'

const TEST_FILE = '/tmp/test-text.hwpx'
const TEST_TABLE_FILE = '/tmp/test-text-table.hwpx'
const TEST_HWP_FILE = '/tmp/test-text.hwp'
const TEST_HWP_TABLE_FILE = '/tmp/test-text-table.hwp'

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
})
