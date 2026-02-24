import { afterEach, describe, expect, it } from 'bun:test'
import {
  checkViewerCorruption,
  cleanupFiles,
  crossValidate,
  FIXTURES,
  isHwpViewerAvailable,
  parseOutput,
  runCli,
  tempCopy,
} from './helpers'

const tempFiles: string[] = []
const isViewerAvailable = await isHwpViewerAvailable()

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('runCli', () => {
  it('returns version string', async () => {
    const result = await runCli(['--version'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('0.1.0')
  })

  it('reads a real fixture without errors', async () => {
    const result = await runCli(['read', FIXTURES.victimStatement])
    expect(result.exitCode).toBe(0)
    const output = parseOutput(result) as any
    expect(output.format).toBe('hwp')
  })

  it('handles Korean filenames correctly', async () => {
    const result = await runCli(['text', FIXTURES.employmentContract])
    expect(result.exitCode).toBe(0)
    const output = parseOutput(result) as any
    expect(output.text).toContain('표준근로계약서')
  })
})

describe('tempCopy + cleanupFiles', () => {
  it('creates a temp copy and cleans it up', async () => {
    const temp = await tempCopy(FIXTURES.victimStatement)
    tempFiles.push(temp)
    const { existsSync } = await import('node:fs')
    expect(existsSync(temp)).toBe(true)
    await cleanupFiles([temp])
    expect(existsSync(temp)).toBe(false)
    tempFiles.length = 0
  })
})

describe('crossValidate', () => {
  it('finds expected text in converted HWPX XML', async () => {
    const temp = await tempCopy(FIXTURES.employmentContract)
    tempFiles.push(temp)

    // given — s0.p0 is empty in this fixture
    const before_s0p0 = await runCli(['text', FIXTURES.employmentContract, 's0.p0'])
    expect((parseOutput(before_s0p0) as any).text).toBe('')

    await runCli(['edit', 'text', temp, 's0.p0', 'CROSSVAL_UNIQUE_MARKER'])
    const found = await crossValidate(temp, 'CROSSVAL_UNIQUE_MARKER')
    expect(found).toBe(true)
  })
})

describe('viewer corruption check', () => {
  it('isHwpViewerAvailable returns a boolean', async () => {
    const result = await isHwpViewerAvailable()
    expect(typeof result).toBe('boolean')
  })

  describe.skipIf(isViewerAvailable)('when viewer is NOT available', () => {
    it('checkViewerCorruption returns skipped=true', async () => {
      const result = await checkViewerCorruption(FIXTURES.assaultComplaint)
      expect(result.skipped).toBe(true)
      expect(result.corrupted).toBe(false)
    })
  })

  describe.skipIf(!isViewerAvailable)('when viewer IS available', () => {
    it('unmodified fixture passes corruption check', async () => {
      const temp = await tempCopy(FIXTURES.assaultComplaint)
      tempFiles.push(temp)
      const result = await checkViewerCorruption(temp)
      expect(result.corrupted).toBe(false)
      expect(result.skipped).toBe(false)
    }, 15_000)
  })
})
