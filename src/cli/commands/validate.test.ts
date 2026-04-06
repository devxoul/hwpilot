import { afterAll, afterEach, beforeAll, describe, expect, it, mock, spyOn } from 'bun:test'
import { rm } from 'node:fs/promises'

import * as validatorModule from '@/formats/hwp/validator'
import { createTestHwpBinary, createTestHwpx } from '@/test-helpers'
import * as viewerModule from '@/shared/viewer'

import { validateCommand } from './validate'

const TEST_HWP_FILE = '/tmp/test-validate.hwp'
const TEST_HWPX_FILE = '/tmp/test-validate.hwpx'
const TEST_CORRUPTED_FILE = '/tmp/test-validate-corrupted.hwp'

let logs: string[]
const origWrite = process.stdout.write
const origExit = process.exit
const origViewerEnv = process.env.HWPILOT_VIEWER

beforeAll(async () => {
  const hwpBuffer = await createTestHwpBinary({ paragraphs: ['hello'] })
  await Bun.write(TEST_HWP_FILE, hwpBuffer)

  const hwpxBuffer = await createTestHwpx({ paragraphs: ['hello'] })
  await Bun.write(TEST_HWPX_FILE, hwpxBuffer)

  // Create corrupted file: write garbage bytes
  await Bun.write(TEST_CORRUPTED_FILE, Buffer.from('not a hwp file at all'))
})

afterAll(async () => {
  await rm(TEST_HWP_FILE, { force: true })
  await rm(TEST_HWPX_FILE, { force: true })
  await rm(TEST_CORRUPTED_FILE, { force: true })
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

function restoreViewerEnv() {
  if (origViewerEnv === undefined) {
    delete process.env.HWPILOT_VIEWER
    return
  }

  process.env.HWPILOT_VIEWER = origViewerEnv
}

describe('validateCommand', () => {
  afterEach(() => {
    restoreOutput()
    restoreViewerEnv()
    mock.restore()
  })

  it('outputs valid JSON for clean HWP file without viewer check by default', async () => {
    captureOutput()
    const viewerSpy = spyOn(viewerModule, 'checkViewerCorruption')
    await validateCommand(TEST_HWP_FILE, {})
    viewerSpy.mockRestore()

    const output = JSON.parse(logs[0])
    expect(output.valid).toBe(true)
    expect(output.format).toBe('hwp')
    expect(output.file).toBe(TEST_HWP_FILE)
    expect(Array.isArray(output.checks)).toBe(true)
    expect(output.checks.some((check: { name: string }) => check.name === 'viewer')).toBe(false)
    expect(viewerSpy).not.toHaveBeenCalled()
  })

  it('returns exit 0 for valid file when viewer is disabled', async () => {
    captureOutput()
    const viewerSpy = spyOn(viewerModule, 'checkViewerCorruption')
    await validateCommand(TEST_HWP_FILE, {})
    viewerSpy.mockRestore()

    const output = JSON.parse(logs[0])
    expect(output.valid).toBe(true)
    expect(output.checks.some((check: { name: string }) => check.name === 'viewer')).toBe(false)
    expect(viewerSpy).not.toHaveBeenCalled()
  })

  it('runs viewer check only when HWPILOT_VIEWER=1', async () => {
    captureOutput()
    process.env.HWPILOT_VIEWER = '1'
    const viewerSpy = spyOn(viewerModule, 'checkViewerCorruption').mockResolvedValue({
      corrupted: false,
      skipped: false,
    })
    await validateCommand(TEST_HWP_FILE, {})
    viewerSpy.mockRestore()

    const output = JSON.parse(logs[0])
    expect(output.valid).toBe(true)
    expect(output.checks.at(-1)).toEqual({ name: 'viewer', status: 'pass' })
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
    const viewerSpy = spyOn(viewerModule, 'checkViewerCorruption').mockResolvedValue({
      corrupted: false,
      skipped: true,
    })

    try {
      await validateCommand(TEST_CORRUPTED_FILE, {})
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'process.exit') {
        throw e
      }
    }

    viewerSpy.mockRestore()
    expect(exitCalled).toBe(true)
    expect(exitCode).toBe(1)
    expect(viewerSpy).not.toHaveBeenCalled()
  })

  it('skips viewer when structural validation already failed', async () => {
    captureOutput()
    let exitCalled = false
    let exitCode = 0
    process.exit = mock((code?: number) => {
      exitCalled = true
      exitCode = code ?? 0
      throw new Error('process.exit')
    }) as never

    const validateSpy = spyOn(validatorModule, 'validateHwp').mockResolvedValue({
      valid: false,
      format: 'hwp',
      file: TEST_HWP_FILE,
      checks: [{ name: 'cfb_structure', status: 'fail', message: 'Missing DocInfo stream' }],
    })
    const viewerSpy = spyOn(viewerModule, 'checkViewerCorruption').mockResolvedValue({
      corrupted: false,
      skipped: false,
    })

    try {
      await validateCommand(TEST_HWP_FILE, {})
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'process.exit') {
        throw e
      }
    }

    validateSpy.mockRestore()
    viewerSpy.mockRestore()

    const output = JSON.parse(logs[0])
    expect(output.valid).toBe(false)
    expect(output.checks).toEqual([{ name: 'cfb_structure', status: 'fail', message: 'Missing DocInfo stream' }])
    expect(viewerSpy).not.toHaveBeenCalled()
    expect(exitCalled).toBe(true)
    expect(exitCode).toBe(1)
  })

  it('returns exit 1 when viewer reports corruption', async () => {
    captureOutput()
    process.env.HWPILOT_VIEWER = '1'
    let exitCalled = false
    let exitCode = 0
    process.exit = mock((code?: number) => {
      exitCalled = true
      exitCode = code ?? 0
      throw new Error('process.exit')
    }) as never
    const viewerSpy = spyOn(viewerModule, 'checkViewerCorruption').mockResolvedValue({
      corrupted: true,
      alert: '파일이 손상되었습니다',
      skipped: false,
    })

    try {
      await validateCommand(TEST_HWP_FILE, {})
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'process.exit') {
        throw e
      }
    }

    viewerSpy.mockRestore()

    const output = JSON.parse(logs[0])
    expect(output.valid).toBe(false)
    expect(output.checks.at(-1)).toEqual({
      name: 'viewer',
      status: 'fail',
      message: 'Hancom Office HWP Viewer detected corruption',
      details: { alert: '파일이 손상되었습니다' },
    })
    expect(exitCalled).toBe(true)
    expect(exitCode).toBe(1)
  })

  it('supports --pretty flag', async () => {
    captureOutput()
    const viewerSpy = spyOn(viewerModule, 'checkViewerCorruption')
    await validateCommand(TEST_HWP_FILE, { pretty: true })
    viewerSpy.mockRestore()

    expect(logs[0]).toContain('\n')
    const output = JSON.parse(logs[0])
    expect(output.valid).toBe(true)
    expect(viewerSpy).not.toHaveBeenCalled()
  })

  it('handles file not found gracefully', async () => {
    captureOutput()
    let exitCalled = false
    process.exit = mock((_code?: number) => {
      exitCalled = true
      throw new Error('process.exit')
    }) as never
    const viewerSpy = spyOn(viewerModule, 'checkViewerCorruption')

    try {
      await validateCommand('/tmp/nonexistent-validate.hwp', {})
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'process.exit') {
        throw e
      }
    }

    viewerSpy.mockRestore()
    expect(exitCalled).toBe(true)
  })

  it('handles HWPX file gracefully', async () => {
    captureOutput()
    const viewerSpy = spyOn(viewerModule, 'checkViewerCorruption')
    await validateCommand(TEST_HWPX_FILE, {})
    viewerSpy.mockRestore()

    const output = JSON.parse(logs[0])
    expect(output.valid).toBe(true)
    expect(output.format).toBe('hwpx')
    expect(output.checks).toHaveLength(1)
    expect(output.checks[0].status).toBe('skip')
    expect(viewerSpy).not.toHaveBeenCalled()
  })
})
