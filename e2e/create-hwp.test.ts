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

    it('creates with title text readable back', async () => {
      const file = tempHwpPath('-title')
      await runCli(['create', file, '--title', '테스트 문서'])

      const readResult = await runCli(['read', file])
      const doc = parseOutput(readResult) as any
      expect(doc.format).toBe('hwp')
      expect(doc.sections).toHaveLength(1)
      expect(doc.sections[0].paragraphs).toHaveLength(1)
    })

    it('created file text matches input', async () => {
      const file = tempHwpPath('-text')
      await runCli(['create', file, '--title', '안녕하세요'])

      const textResult = await runCli(['text', file, 's0.p0'])
      const textOutput = parseOutput(textResult) as any
      expect(textOutput.text).toBe('안녕하세요')
    })
  })

  describe('B. Cross-validation via convert', () => {
    it('created HWP converts to HWPX with correct content', async () => {
      const hwpFile = tempHwpPath('-convert')
      const hwpxFile = hwpFile.replace(/\.hwp$/, '.hwpx')
      tempFiles.push(hwpxFile)

      await runCli(['create', hwpFile, '--title', '변환 테스트'])
      const convertResult = await runCli(['convert', hwpFile, hwpxFile])
      expect(convertResult.exitCode).toBe(0)

      const readResult = await runCli(['text', hwpxFile, 's0.p0'])
      const textOutput = parseOutput(readResult) as any
      expect(textOutput.text).toBe('변환 테스트')
    })
  })
})

describe.skipIf(!isViewerAvailable)('Z. Viewer Compatibility Check', () => {
  it('created HWP opens in viewer without any alert dialog', async () => {
    const file = tempHwpPath('-viewer')
    await runCli(['create', file, '--title', 'viewer-compat-test'])

    const result = await checkViewerCorruption(file)
    expect(result.skipped).toBe(false)
    expect(result.corrupted).toBe(false)
    expect(result.alert).toBeUndefined()
  }, 15_000)

  it('multi-paragraph HWP with Korean content opens without alert', async () => {
    const file = tempHwpPath('-multi')
    // Create multi-paragraph HWP directly via createHwp
    const { createHwp } = await import('../src/formats/hwp/creator')
    const { writeFile } = await import('node:fs/promises')
    const paragraphs = [
      'hwpilot — AI 에이전트를 위한 HWP 편집기',
      'HWP는 한국에서 가장 많이 사용되는 문서 포맷입니다.',
      '이 도구는 HWP/HWPX 파일을 프로그래밍 방식으로 읽고 쓸 수 있게 합니다.',
      'npm install -g hwpilot',
      'hwpilot read document.hwpx --limit 20',
    ]
    const buffer = await createHwp({ paragraphs })
    await writeFile(file, buffer)

    const result = await checkViewerCorruption(file)
    expect(result.skipped).toBe(false)
    expect(result.corrupted).toBe(false)
    expect(result.alert).toBeUndefined()
  }, 15_000)
})
