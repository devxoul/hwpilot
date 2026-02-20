import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createTestHwpx } from '@/test-helpers'
import { tableEditCommand, tableListCommand, tableReadCommand } from './table'

const TEST_FILE = '/tmp/test-table.hwpx'

let logs: string[]
let errors: string[]
const origLog = console.log
const origError = console.error
const origExit = process.exit

function captureOutput() {
  logs = []
  errors = []
  console.log = (msg: string) => logs.push(msg)
  console.error = (msg: string) => errors.push(msg)
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

describe('tableReadCommand', () => {
  beforeEach(async () => {
    const buffer = await createTestHwpx({
      paragraphs: ['Intro'],
      tables: [
        {
          rows: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
      ],
    })
    await Bun.write(TEST_FILE, buffer)
  })

  it('reads table structure with correct refs and text', async () => {
    captureOutput()
    await tableReadCommand(TEST_FILE, 's0.t0', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.t0')
    expect(output.rows).toHaveLength(2)
    expect(output.rows[0].cells).toHaveLength(2)
    expect(output.rows[0].cells[0].ref).toBe('s0.t0.r0.c0')
    expect(output.rows[0].cells[0].text).toBe('A')
    expect(output.rows[0].cells[1].ref).toBe('s0.t0.r0.c1')
    expect(output.rows[0].cells[1].text).toBe('B')
    expect(output.rows[1].cells[0].ref).toBe('s0.t0.r1.c0')
    expect(output.rows[1].cells[0].text).toBe('C')
    expect(output.rows[1].cells[1].ref).toBe('s0.t0.r1.c1')
    expect(output.rows[1].cells[1].text).toBe('D')
    expect(output.rows[0].cells[0].paragraphs).toBeDefined()
  })

  it('errors for non-table ref', async () => {
    captureOutput()
    await expect(tableReadCommand(TEST_FILE, 's0.p0', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Not a table reference')
  })
})

describe('tableEditCommand', () => {
  beforeEach(async () => {
    const buffer = await createTestHwpx({
      paragraphs: ['Intro'],
      tables: [
        {
          rows: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
      ],
    })
    await Bun.write(TEST_FILE, buffer)
  })

  it('edits a table cell and verifies', async () => {
    captureOutput()
    await tableEditCommand(TEST_FILE, 's0.t0.r0.c0', 'Changed', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.t0.r0.c0', text: 'Changed', success: true })

    captureOutput()
    await tableReadCommand(TEST_FILE, 's0.t0', {})
    restoreOutput()

    const table = JSON.parse(logs[0])
    expect(table.rows[0].cells[0].text).toBe('Changed')
  })

  it('errors for non-cell ref', async () => {
    captureOutput()
    await expect(tableEditCommand(TEST_FILE, 's0.t0', 'text', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Not a cell reference')
  })
})

describe('tableListCommand', () => {
  beforeEach(async () => {
    const buffer = await createTestHwpx({
      paragraphs: ['Intro'],
      tables: [
        {
          rows: [
            ['A', 'B'],
            ['C', 'D'],
          ],
        },
        { rows: [['X', 'Y', 'Z']] },
      ],
    })
    await Bun.write(TEST_FILE, buffer)
  })

  it('lists all tables with refs, rows, and cols', async () => {
    captureOutput()
    await tableListCommand(TEST_FILE, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toHaveLength(2)
    expect(output[0]).toEqual({ ref: 's0.t0', rows: 2, cols: 2 })
    expect(output[1]).toEqual({ ref: 's0.t1', rows: 1, cols: 3 })
  })

  it('returns empty array for document without tables', async () => {
    const buffer = await createTestHwpx({ paragraphs: ['No tables here'] })
    await Bun.write(TEST_FILE, buffer)

    captureOutput()
    await tableListCommand(TEST_FILE, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual([])
  })
})

describe('table pretty output', () => {
  beforeEach(async () => {
    const buffer = await createTestHwpx({
      paragraphs: ['Intro'],
      tables: [{ rows: [['X']] }],
    })
    await Bun.write(TEST_FILE, buffer)
  })

  it('produces indented JSON with --pretty', async () => {
    captureOutput()
    await tableReadCommand(TEST_FILE, 's0.t0', { pretty: true })
    restoreOutput()

    expect(logs[0]).toContain('\n')
    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.t0')
  })
})
