import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { loadHwp } from '@/formats/hwp/reader'
import { createTestHwpBinary, createTestHwpx } from '@/test-helpers'
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

beforeAll(() => {
  process.env.HWPILOT_NO_DAEMON = '1'
})

afterAll(() => {
  delete process.env.HWPILOT_NO_DAEMON
})

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

  it('edits text in HWP file', async () => {
    const hwpFile = '/tmp/test-edit-text-hwp5.hwp'
    const hwpBuffer = await createTestHwpBinary({ paragraphs: ['Hello'] })
    await Bun.write(hwpFile, hwpBuffer)

    captureOutput()
    await editTextCommand(hwpFile, 's0.p0', 'Modified', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.p0', text: 'Modified', success: true })

    const doc = await loadHwp(hwpFile)
    const text = doc.sections[0].paragraphs[0].runs.map((r) => r.text).join('')
    expect(text).toBe('Modified')
  })

  it('edits table cell text in HWP file', async () => {
    const hwpFile = '/tmp/test-edit-text-hwp5-table.hwp'
    const hwpBuffer = await createTestHwpBinary({ tables: [{ rows: [['A', 'B']] }] })
    await Bun.write(hwpFile, hwpBuffer)

    captureOutput()
    await editTextCommand(hwpFile, 's0.t0.r0.c0', 'Changed', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.t0.r0.c0', text: 'Changed', success: true })

    const doc = await loadHwp(hwpFile)
    const cellText = doc.sections[0].tables[0].rows[0].cells[0].paragraphs
      .flatMap((p) => p.runs.map((r) => r.text))
      .join('')
    expect(cellText).toBe('Changed')
  })

  it('outputs pretty JSON when --pretty', async () => {
    captureOutput()
    await editTextCommand(TEST_FILE, 's0.p0', 'Pretty', { pretty: true })
    restoreOutput()

    expect(logs[0]).toContain('\n')
    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.p0', text: 'Pretty', success: true })
  })

  it('edits text box paragraph in HWPX', async () => {
    const tbFile = '/tmp/test-edit-text-textbox.hwpx'
    const buffer = await createTestHwpx({
      paragraphs: ['Normal'],
      textBoxes: [{ text: 'Original' }],
    })
    await Bun.write(tbFile, buffer)

    captureOutput()
    await editTextCommand(tbFile, 's0.tb0.p0', 'Edited', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.tb0.p0', text: 'Edited', success: true })
  })

  it('edits text box paragraph in HWP', async () => {
    const tbHwpFile = '/tmp/test-edit-text-textbox.hwp'
    const hwpBuffer = await createTestHwpBinary({
      paragraphs: ['Normal'],
      textBoxes: [{ text: 'Original' }],
    })
    await Bun.write(tbHwpFile, hwpBuffer)

    captureOutput()
    await editTextCommand(tbHwpFile, 's0.tb0.p0', 'Modified', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.tb0.p0', text: 'Modified', success: true })

    // cross-validate
    const doc = await loadHwp(tbHwpFile)
    const tbText = doc.sections[0].textBoxes[0].paragraphs[0].runs.map((r) => r.text).join('')
    expect(tbText).toBe('Modified')
  })
})
