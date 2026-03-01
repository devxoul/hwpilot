import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { createTestHwpx } from '@/test-helpers'
import { paragraphAddCommand } from './paragraph'

const TEST_FILE = '/tmp/test-paragraph.hwpx'

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

describe('paragraphAddCommand', () => {
  beforeEach(async () => {
    const buffer = await createTestHwpx({
      paragraphs: ['First paragraph', 'Second paragraph'],
    })
    await Bun.write(TEST_FILE, buffer)
  })

  it('rejects invalid position', async () => {
    captureOutput()
    await expect(paragraphAddCommand(TEST_FILE, 's0', 'New text', { position: 'invalid' })).rejects.toThrow(
      'process.exit',
    )
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Invalid position')
  })

  it('accepts position before', async () => {
    captureOutput()
    await paragraphAddCommand(TEST_FILE, 's0.p0', 'New text', { position: 'before' })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })

  it('accepts position after', async () => {
    captureOutput()
    await paragraphAddCommand(TEST_FILE, 's0.p0', 'New text', { position: 'after' })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })

  it('defaults to position end', async () => {
    captureOutput()
    await paragraphAddCommand(TEST_FILE, 's0', 'New text', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })

  it('assembles format options into format object', async () => {
    captureOutput()
    await paragraphAddCommand(TEST_FILE, 's0', 'New text', {
      bold: true,
      italic: true,
      font: 'Arial',
      size: 14,
    })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })

  it('handles bold option', async () => {
    captureOutput()
    await paragraphAddCommand(TEST_FILE, 's0', 'New text', { bold: true })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })

  it('handles color option', async () => {
    captureOutput()
    await paragraphAddCommand(TEST_FILE, 's0', 'New text', { color: '#FF0000' })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })

  it('--heading 1 sets heading in operation', async () => {
    captureOutput()
    await paragraphAddCommand(TEST_FILE, 's0', 'Heading text', { heading: 1 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })

  it('--heading 3 sets heading in operation', async () => {
    captureOutput()
    await paragraphAddCommand(TEST_FILE, 's0', 'Heading text', { heading: 3 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })

  it('--style "개요 2" sets style by name', async () => {
    captureOutput()
    await paragraphAddCommand(TEST_FILE, 's0', 'Styled text', { style: '개요 2' })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })

  it('--style 3 sets style by numeric ID', async () => {
    captureOutput()
    await paragraphAddCommand(TEST_FILE, 's0', 'Styled text', { style: 3 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })

  it('--heading 1 --style "개요 1" simultaneously rejects', async () => {
    captureOutput()
    await expect(paragraphAddCommand(TEST_FILE, 's0', 'Text', { heading: 1, style: '개요 1' })).rejects.toThrow(
      'process.exit',
    )
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Cannot specify both --heading and --style')
  })

  it('--heading 0 rejects (invalid level)', async () => {
    captureOutput()
    await expect(paragraphAddCommand(TEST_FILE, 's0', 'Text', { heading: 0 })).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Heading level must be between 1 and 7')
  })

  it('--heading 8 rejects (out of range)', async () => {
    captureOutput()
    await expect(paragraphAddCommand(TEST_FILE, 's0', 'Text', { heading: 8 })).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Heading level must be between 1 and 7')
  })
})
