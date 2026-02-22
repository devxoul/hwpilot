import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { createTestHwpBinary, createTestHwpx } from '@/test-helpers'
import { findCommand } from './find'

const TEST_HWPX = '/tmp/test-find.hwpx'
const TEST_HWP = '/tmp/test-find.hwp'
const TEST_TABLE_HWPX = '/tmp/test-find-table.hwpx'
const TEST_TABLE_HWP = '/tmp/test-find-table.hwp'
const TEST_TEXTBOX_HWPX = '/tmp/test-find-textbox.hwpx'
const TEST_TEXTBOX_HWP = '/tmp/test-find-textbox.hwp'
const TEST_ALL_HWPX = '/tmp/test-find-all.hwpx'
const TEST_ALL_HWP = '/tmp/test-find-all.hwp'

let logs: string[]
const origLog = console.log
const origError = console.error
const origExit = process.exit

beforeAll(async () => {
  const hwpxBuf = await createTestHwpx({ paragraphs: ['Hello World', 'Goodbye World', 'Something Else'] })
  await Bun.write(TEST_HWPX, hwpxBuf)
  const hwpBuf = await createTestHwpBinary({ paragraphs: ['Hello World', 'Goodbye World', 'Something Else'] })
  await Bun.write(TEST_HWP, hwpBuf)

  const tableHwpx = await createTestHwpx({
    paragraphs: ['Intro'],
    tables: [
      {
        rows: [
          ['Cell Alpha', 'Cell Beta'],
          ['Cell Gamma', 'Cell Delta'],
        ],
      },
    ],
  })
  await Bun.write(TEST_TABLE_HWPX, tableHwpx)
  const tableHwp = await createTestHwpBinary({
    paragraphs: ['Intro'],
    tables: [
      {
        rows: [
          ['Cell Alpha', 'Cell Beta'],
          ['Cell Gamma', 'Cell Delta'],
        ],
      },
    ],
  })
  await Bun.write(TEST_TABLE_HWP, tableHwp)

  const tbHwpx = await createTestHwpx({
    paragraphs: ['Main paragraph'],
    textBoxes: [{ text: 'TextBox Content' }],
  })
  await Bun.write(TEST_TEXTBOX_HWPX, tbHwpx)
  const tbHwp = await createTestHwpBinary({
    paragraphs: ['Main paragraph'],
    textBoxes: [{ text: 'TextBox Content' }],
  })
  await Bun.write(TEST_TEXTBOX_HWP, tbHwp)

  const allHwpx = await createTestHwpx({
    paragraphs: ['Search target here'],
    tables: [{ rows: [['target in cell']] }],
    textBoxes: [{ text: 'target in box' }],
  })
  await Bun.write(TEST_ALL_HWPX, allHwpx)
  const allHwp = await createTestHwpBinary({
    paragraphs: ['Search target here'],
    tables: [{ rows: [['target in cell']] }],
    textBoxes: [{ text: 'target in box' }],
  })
  await Bun.write(TEST_ALL_HWP, allHwp)
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

describe('findCommand', () => {
  describe('HWPX format', () => {
    it('finds matching paragraphs', async () => {
      captureOutput()
      await findCommand(TEST_HWPX, 'World', {})
      restoreOutput()

      expect(logs.length).toBe(2)
      expect(logs[0]).toContain('s0.p0')
      expect(logs[0]).toContain('Hello World')
      expect(logs[1]).toContain('s0.p1')
      expect(logs[1]).toContain('Goodbye World')
    })

    it('finds in table cells', async () => {
      captureOutput()
      await findCommand(TEST_TABLE_HWPX, 'Alpha', {})
      restoreOutput()

      expect(logs.length).toBe(1)
      expect(logs[0]).toContain('Cell Alpha')
    })

    it('finds in text boxes', async () => {
      captureOutput()
      await findCommand(TEST_TEXTBOX_HWPX, 'TextBox', {})
      restoreOutput()

      expect(logs.length).toBe(1)
      expect(logs[0]).toContain('TextBox Content')
    })

    it('finds across all container types', async () => {
      captureOutput()
      await findCommand(TEST_ALL_HWPX, 'target', {})
      restoreOutput()

      expect(logs.length).toBe(3)
    })

    it('is case-insensitive', async () => {
      captureOutput()
      await findCommand(TEST_HWPX, 'hello', {})
      restoreOutput()

      expect(logs.length).toBe(1)
      expect(logs[0]).toContain('Hello World')
    })

    it('returns empty output for no matches', async () => {
      captureOutput()
      await findCommand(TEST_HWPX, 'NONEXISTENT', {})
      restoreOutput()

      expect(logs.length).toBe(0)
    })

    it('outputs JSON with --json flag', async () => {
      captureOutput()
      await findCommand(TEST_ALL_HWPX, 'target', { json: true })
      restoreOutput()

      expect(logs.length).toBe(1)
      const output = JSON.parse(logs[0])
      expect(output.matches).toBeArray()
      expect(output.matches.length).toBe(3)
      for (const m of output.matches) {
        expect(m).toHaveProperty('ref')
        expect(m).toHaveProperty('text')
        expect(m).toHaveProperty('container')
      }
    })

    it('JSON output has correct container types', async () => {
      captureOutput()
      await findCommand(TEST_ALL_HWPX, 'target', { json: true })
      restoreOutput()

      const output = JSON.parse(logs[0])
      const containers = output.matches.map((m: { container: string }) => m.container).sort()
      expect(containers).toEqual(['paragraph', 'table', 'textBox'])
    })

    it('JSON output is empty array for no matches', async () => {
      captureOutput()
      await findCommand(TEST_HWPX, 'NONEXISTENT', { json: true })
      restoreOutput()

      expect(logs.length).toBe(1)
      const output = JSON.parse(logs[0])
      expect(output.matches).toEqual([])
    })

    it('default output format is ref: text', async () => {
      captureOutput()
      await findCommand(TEST_HWPX, 'Hello', {})
      restoreOutput()

      expect(logs.length).toBe(1)
      expect(logs[0]).toBe('s0.p0: Hello World')
    })
  })

  describe('HWP format', () => {
    it('finds matching paragraphs', async () => {
      captureOutput()
      await findCommand(TEST_HWP, 'World', {})
      restoreOutput()

      expect(logs.length).toBe(2)
      expect(logs[0]).toContain('Hello World')
      expect(logs[1]).toContain('Goodbye World')
    })

    it('finds in table cells', async () => {
      captureOutput()
      await findCommand(TEST_TABLE_HWP, 'Alpha', {})
      restoreOutput()

      expect(logs.length).toBe(1)
      expect(logs[0]).toContain('Cell Alpha')
    })

    it('finds in text boxes', async () => {
      captureOutput()
      await findCommand(TEST_TEXTBOX_HWP, 'TextBox', {})
      restoreOutput()

      expect(logs.length).toBe(1)
      expect(logs[0]).toContain('TextBox Content')
    })

    it('is case-insensitive', async () => {
      captureOutput()
      await findCommand(TEST_HWP, 'hello', {})
      restoreOutput()

      expect(logs.length).toBe(1)
      expect(logs[0]).toContain('Hello World')
    })

    it('finds across all container types', async () => {
      captureOutput()
      await findCommand(TEST_ALL_HWP, 'target', {})
      restoreOutput()

      expect(logs.length).toBe(3)
    })
  })

  describe('error handling', () => {
    it('errors for nonexistent file', async () => {
      captureOutput()
      await expect(findCommand('/tmp/nonexistent-find.hwpx', 'test', {})).rejects.toThrow('process.exit')
      restoreOutput()

      const output = JSON.parse(logs[0])
      expect(output.error).toBeDefined()
    })
  })
})
