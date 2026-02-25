import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { cleanupFiles, crossValidate, FIXTURES, parseOutput, runCli, tempCopy } from './helpers'

const FIXTURE = FIXTURES.wageClaim
const tempFiles: string[] = []

function tempPath(suffix: string, ext = '.hwpx'): string {
  const p = join(tmpdir(), `e2e-inline-fmt-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  tempFiles.push(p)
  return p
}

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Inline Format — HWPX', () => {
  describe('A. Partial Inline Format', () => {
    it('applies bold to partial range and text is preserved', async () => {
      const hwpxFile = tempPath('partial-bold')

      // given — create HWPX with known text (no space at split boundary)
      await runCli(['create', hwpxFile])
      await runCli(['edit', 'text', hwpxFile, 's0.p0', 'ABCDEFGHIJ'])

      // when — bold first 5 chars "ABCDE"
      const fmtResult = await runCli(['edit', 'format', hwpxFile, 's0.p0', '--bold', '--start', '0', '--end', '5'])
      expect(fmtResult.exitCode).toBe(0)
      const fmtOutput = parseOutput(fmtResult) as any
      expect(fmtOutput.success).toBe(true)

      // then — text is preserved
      const readResult = await runCli(['read', hwpxFile, '--pretty'])
      expect(readResult.exitCode).toBe(0)
      const doc = parseOutput(readResult) as any
      const para = doc.sections[0].paragraphs[0]
      const fullText = para.runs ? para.runs.map((r: any) => r.text).join('') : para.text
      expect(fullText).toBe('ABCDEFGHIJ')
    })

    it('partial format creates multiple runs in XML', async () => {
      const hwpxFile = tempPath('multi-run')

      // given
      await runCli(['create', hwpxFile])
      await runCli(['edit', 'text', hwpxFile, 's0.p0', 'Hello World'])

      // when — bold "Hello" only
      await runCli(['edit', 'format', hwpxFile, 's0.p0', '--bold', '--start', '0', '--end', '5'])

      // then — inspect raw XML for multiple hp:run nodes
      const data = await readFile(hwpxFile)
      const zip = await JSZip.loadAsync(data)
      const xml = await zip.file('Contents/section0.xml')?.async('string')
      expect(xml).toBeDefined()

      // partial format should produce more than one run
      const runMatches = xml!.match(/<hp:run\b/g)
      expect(runMatches).not.toBeNull()
      expect(runMatches!.length).toBeGreaterThanOrEqual(2)

      // text content preserved in XML
      expect(xml).toContain('Hello')
      expect(xml).toContain('World')
    })
  })

  describe('B. Backward Compatibility', () => {
    it('format without --start/--end applies to entire paragraph', async () => {
      const hwpxFile = tempPath('whole-para')

      // given
      await runCli(['create', hwpxFile])
      await runCli(['edit', 'text', hwpxFile, 's0.p0', 'Full Bold'])

      // when — bold without offsets (whole paragraph)
      const fmtResult = await runCli(['edit', 'format', hwpxFile, 's0.p0', '--bold'])
      expect(fmtResult.exitCode).toBe(0)
      const fmtOutput = parseOutput(fmtResult) as any
      expect(fmtOutput.success).toBe(true)

      // then — text preserved
      const readResult = await runCli(['read', hwpxFile, '--pretty'])
      const doc = parseOutput(readResult) as any
      const para = doc.sections[0].paragraphs[0]
      const fullText = para.runs ? para.runs.map((r: any) => r.text).join('') : para.text
      expect(fullText).toBe('Full Bold')
    })
  })

  describe('C. Error Cases', () => {
    it('out-of-range offset returns error', async () => {
      const hwpxFile = tempPath('out-of-range')

      // given — short text
      await runCli(['create', hwpxFile])
      await runCli(['edit', 'text', hwpxFile, 's0.p0', 'Hi'])

      // when — end offset far beyond text length
      const result = await runCli(['edit', 'format', hwpxFile, 's0.p0', '--bold', '--start', '0', '--end', '100'])

      // then — should fail
      expect(result.exitCode).not.toBe(0)
    })

    it('start >= end returns error', async () => {
      const hwpxFile = tempPath('bad-range')

      // given
      await runCli(['create', hwpxFile])
      await runCli(['edit', 'text', hwpxFile, 's0.p0', 'Hello World'])

      // when — start >= end
      const result = await runCli(['edit', 'format', hwpxFile, 's0.p0', '--bold', '--start', '5', '--end', '5'])

      // then — should fail
      expect(result.exitCode).not.toBe(0)
    })
  })
})

describe('Inline Format — HWP', () => {
  describe('A. Partial Inline Format', () => {
    it('applies bold to partial range and text is preserved', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — read first paragraph text
      const beforeResult = await runCli(['read', temp, '--pretty'])
      const beforeDoc = parseOutput(beforeResult) as any
      const firstPara = beforeDoc.sections[0].paragraphs[0]
      const originalText = firstPara.runs ? firstPara.runs.map((r: any) => r.text).join('') : firstPara.text

      // when — apply bold to first 2 chars
      const end = Math.min(2, originalText.length)
      const fmtResult = await runCli(['edit', 'format', temp, 's0.p0', '--bold', '--start', '0', '--end', String(end)])
      expect(fmtResult.exitCode).toBe(0)

      // then — text is preserved
      const afterResult = await runCli(['read', temp, '--pretty'])
      const afterDoc = parseOutput(afterResult) as any
      const afterPara = afterDoc.sections[0].paragraphs[0]
      const afterText = afterPara.runs ? afterPara.runs.map((r: any) => r.text).join('') : afterPara.text
      expect(afterText).toBe(originalText)
    })
  })

  describe('B. Cross-Validation', () => {
    it('inline format survives HWP→HWPX conversion', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — set known marker text
      const marker = 'INLINE_FMT_CV_2026'
      await runCli(['edit', 'text', temp, 's0.p0', marker])

      // when — apply inline bold
      const fmtResult = await runCli(['edit', 'format', temp, 's0.p0', '--bold', '--start', '0', '--end', '6'])
      expect(fmtResult.exitCode).toBe(0)

      // then — text survives conversion
      const found = await crossValidate(temp, marker)
      expect(found).toBe(true)
    })
  })

  describe('C. Backward Compatibility', () => {
    it('format without offsets works identically to before', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — read original text
      const beforeResult = await runCli(['read', temp, '--pretty'])
      const beforeDoc = parseOutput(beforeResult) as any
      const firstPara = beforeDoc.sections[0].paragraphs[0]
      const originalText = firstPara.runs ? firstPara.runs.map((r: any) => r.text).join('') : firstPara.text

      // when — apply bold to whole paragraph (no offsets)
      const fmtResult = await runCli(['edit', 'format', temp, 's0.p0', '--bold'])
      expect(fmtResult.exitCode).toBe(0)
      const fmtOutput = parseOutput(fmtResult) as any
      expect(fmtOutput.success).toBe(true)

      // then — text preserved
      const afterResult = await runCli(['read', temp, '--pretty'])
      const afterDoc = parseOutput(afterResult) as any
      const afterPara = afterDoc.sections[0].paragraphs[0]
      const afterText = afterPara.runs ? afterPara.runs.map((r: any) => r.text).join('') : afterPara.text
      expect(afterText).toBe(originalText)
    })
  })
})
