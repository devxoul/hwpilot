import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { createTestHwpBinary, createTestHwpx } from '@/test-helpers'
import { validateCommand } from './validate'

const TEST_HWP_FILE = '/tmp/test-validate.hwp'
const TEST_HWPX_FILE = '/tmp/test-validate.hwpx'
const TEST_CORRUPTED_FILE = '/tmp/test-validate-corrupted.hwp'

let logs: string[]
const origWrite = process.stdout.write
const origExit = process.exit

beforeAll(async () => {
  const hwpBuffer = await createTestHwpBinary({ paragraphs: ['hello'] })
  await Bun.write(TEST_HWP_FILE, hwpBuffer)

  const hwpxBuffer = await createTestHwpx({ paragraphs: ['hello'] })
  await Bun.write(TEST_HWPX_FILE, hwpxBuffer)

  // Create corrupted file: write garbage bytes
  await Bun.write(TEST_CORRUPTED_FILE, Buffer.from('not a hwp file at all'))
})

afterAll(async () => {
  await Bun.file(TEST_HWP_FILE).delete()
  await Bun.file(TEST_HWPX_FILE).delete()
  await Bun.file(TEST_CORRUPTED_FILE).delete()
})

function captureOutput() {
  logs = []
  process.stdout.write = (msg: string | Uint8Array) => {
    logs.push(typeof msg === 'string' ? msg : Buffer.from(msg).toString())
    return true
  }
  process.exit = mock(() => {
    throw new Error('process.exit')
  }) as never
}

function restoreOutput() {
  process.stdout.write = origWrite
  process.exit = origExit
}

afterEach(restoreOutput)

describe('validateCommand', () => {
  it('outputs valid JSON for clean HWP file', async () => {
    captureOutput()
    await validateCommand(TEST_HWP_FILE, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.valid).toBe(true)
    expect(output.format).toBe('hwp')
    expect(output.file).toBe(TEST_HWP_FILE)
    expect(Array.isArray(output.checks)).toBe(true)
  })

  it('returns exit 0 for valid file', async () => {
    captureOutput()
    await validateCommand(TEST_HWP_FILE, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.valid).toBe(true)
  })

  it('returns exit 1 for corrupted file', async () => {
    captureOutput()
    let exitCalled = false
    let exitCode = 0
    process.exit = mock((code?: number) => {
      exitCalled = true
      exitCode = code ?? 0
      throw new Error('process.exit')
    }) as never

    try {
      await validateCommand(TEST_CORRUPTED_FILE, {})
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'process.exit') {
        throw e
      }
    }

    restoreOutput()
    expect(exitCalled).toBe(true)
    expect(exitCode).toBe(1)
  })

  it('supports --pretty flag', async () => {
    captureOutput()
    await validateCommand(TEST_HWP_FILE, { pretty: true })
    restoreOutput()

    expect(logs[0]).toContain('\n')
    const output = JSON.parse(logs[0])
    expect(output.valid).toBe(true)
  })

  it('handles file not found gracefully', async () => {
    captureOutput()
    let exitCalled = false
    process.exit = mock((code?: number) => {
      exitCalled = true
      throw new Error('process.exit')
    }) as never

    try {
      await validateCommand('/tmp/nonexistent-validate.hwp', {})
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'process.exit') {
        throw e
      }
    }

    restoreOutput()
    expect(exitCalled).toBe(true)
  })

  it('handles HWPX file gracefully', async () => {
    captureOutput()
    await validateCommand(TEST_HWPX_FILE, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.valid).toBe(true)
    expect(output.format).toBe('hwpx')
  })
})
