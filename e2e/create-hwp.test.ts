import { afterEach, describe, expect, it } from 'bun:test'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkViewerCorruption, isHwpViewerAvailable, parseOutput, runCli } from './helpers'

const isViewerAvailable = await isHwpViewerAvailable()

const tempFiles: string[] = []

function tempHwpPath(suffix = ''): string {
  const path = join(tmpdir(), `e2e-create-hwp-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}.hwp`)
  tempFiles.push(path)
  return path
}

afterEach(async () => {
  for (const f of tempFiles) {
    await rm(f, { force: true })
  }
  tempFiles.length = 0
})

describe('HWP Creation', () => {
  describe('A. CLI create command', () => {
    it('creates a .hwp file via CLI', async () => {
      const file = tempHwpPath()
      const result = await runCli(['create', file])
      const output = parseOutput(result) as any
      expect(output.success).toBe(true)
      expect(output.file).toBe(file)
    })

    it('creates a blank .hwp readable back', async () => {
      const file = tempHwpPath('-blank')
      await runCli(['create', file])

      const readResult = await runCli(['read', file])
      const doc = parseOutput(readResult) as any
      expect(doc.format).toBe('hwp')
      expect(doc.sections).toHaveLength(1)
      expect(doc.sections[0].paragraphs).toHaveLength(1)
    })
  })

  describe('B. Cross-validation via convert', () => {
    it('created blank HWP converts to HWPX', async () => {
      const hwpFile = tempHwpPath('-convert')
      const hwpxFile = hwpFile.replace(/\.hwp$/, '.hwpx')
      tempFiles.push(hwpxFile)

      await runCli(['create', hwpFile])
      const convertResult = await runCli(['convert', hwpFile, hwpxFile])
      expect(convertResult.exitCode).toBe(0)
    })
  })
})

describe.skipIf(!isViewerAvailable)('Z. Viewer Compatibility Check', () => {
  it('created blank HWP opens in viewer without any alert dialog', async () => {
    const file = tempHwpPath('-viewer')
    await runCli(['create', file])

    const result = await checkViewerCorruption(file)
    expect(result.skipped).toBe(false)
    expect(result.corrupted).toBe(false)
    expect(result.alert).toBeUndefined()
  }, 15_000)
})