import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createTestHwpCfb, createTestHwpx } from '@/test-helpers'
import { editTextCommand } from './edit-text'

const TEST_FILE = '/tmp/test-edit-text.hwpx'
const TEST_TABLE_FILE = '/tmp/test-edit-text-table.hwpx'

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

describe('editTextCommand', () => {
  beforeEach(async () => {
    const buffer = await createTestHwpx({ paragraphs: ['Hello', 'World'] })
    await Bun.write(TEST_FILE, buffer)

    const tableBuffer = await createTestHwpx({
      paragraphs: ['Intro'],
      tables: [{ rows: [['A', 'B']] }],
    })
    await Bun.write(TEST_TABLE_FILE, tableBuffer)
  })

  it('sets text on a paragraph', async () => {
    captureOutput()
    await editTextCommand(TEST_FILE, 's0.p0', 'Modified', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.p0', text: 'Modified', success: true })

    captureOutput()
    await editTextCommand(TEST_FILE, 's0.p1', 'Also changed', {})
    restoreOutput()

    const output2 = JSON.parse(logs[0])
    expect(output2.success).toBe(true)
  })

  it('sets text on a table cell', async () => {
    captureOutput()
    await editTextCommand(TEST_TABLE_FILE, 's0.t0.r0.c0', 'Changed', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.t0.r0.c0', text: 'Changed', success: true })
  })

  it('errors for invalid ref', async () => {
    captureOutput()
    await expect(editTextCommand(TEST_FILE, 'invalid-ref', 'text', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Invalid reference')
  })

  it('errors for HWP files', async () => {
    const hwpFile = '/tmp/test-edit-text-hwp5.hwp'
    await Bun.write(hwpFile, createTestHwpCfb())
    captureOutput()
    await expect(editTextCommand(hwpFile, 's0.p0', 'text', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toBe('HWP 5.0 write not supported')
  })

  it('outputs pretty JSON when --pretty', async () => {
    captureOutput()
    await editTextCommand(TEST_FILE, 's0.p0', 'Pretty', { pretty: true })
    restoreOutput()

    expect(logs[0]).toContain('\n')
    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.p0', text: 'Pretty', success: true })
  })
})
