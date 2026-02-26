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
  validateFile,
} from './helpers'

const isViewerAvailable = await isHwpViewerAvailable()

const FIXTURE = FIXTURES.wageClaim
const tempFiles: string[] = []

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Wage Claim Lawsuit (임금 등 청구의 소)', () => {
  describe('A. Document Structure', () => {
    it('reads as HWP format with 1 section', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.format).toBe('hwp')
      expect(doc.sections).toHaveLength(1)
    })

    it('has 103 level-0 paragraphs in section 0', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].paragraphs).toHaveLength(103)
    })

    it('detects 2 tables in section 0', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].tables).toHaveLength(2)
    })
  })

  describe('B. Legal Content Verification', () => {
    it('full text contains key legal terms', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toContain('임금 등 청구의 소')
      expect(text).toContain('소장')
      expect(text).toContain('원고')
      expect(text).toContain('피고')
      expect(text).toContain('청   구   취   지')
    })

    it('contains plaintiff names and defendant', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toContain('김○○')
      expect(text).toContain('박○○')
      expect(text).toContain('최○○')
      expect(text).toContain('주식회사◇◇◇◇')
    })

    it('contains monetary amounts and legal references', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      const amounts = ['9,695,279원', '9,555,757원', '7,846,757원']
      const found = amounts.filter((a) => text.includes(a))
      expect(found.length).toBeGreaterThanOrEqual(2)

      expect(text).toContain('근로기준법')
      expect(text).toContain('상법')
    })

    it('s0.p0 is the document title', async () => {
      const paraResult = await runCli(['text', FIXTURE, 's0.p0'])
      const para = parseOutput(paraResult) as any
      expect(para.ref).toBe('s0.p0')
      expect(para.text).toContain('[서식 예] 임금 등 청구의 소')
    })
  })

  describe('C. Image Detection', () => {
    it('detects 6 images via read command', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].images).toHaveLength(6)
      // Known issue: image metadata in HWP is corrupted —
      // all images share same binDataPath, dimensions are wrong
    })

    it('image list succeeds on HWP format', async () => {
      const result = await runCli(['image', 'list', FIXTURE])
      expect(result.exitCode).toBe(0)
      const images = JSON.parse(result.stdout)
      expect(images).toHaveLength(6)
      expect(images[0].ref).toBe('s0.img0')
    })
  })

  describe('D. Editing (Limited)', () => {
    it('edits the only editable paragraph s0.p0', async () => {
      // Only 1 editable paragraph in this fixture.
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p0 contains the document title
      const before_s0p0 = await runCli(['text', FIXTURE, 's0.p0'])
      expect((parseOutput(before_s0p0) as any).text).toContain('임금 등 청구의 소')

      const newText = '[서식 예] 임금 및 퇴직금 청구의 소'
      const editResult = await runCli(['edit', 'text', temp, 's0.p0', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s0.p0')
      expect(editOutput.text).toContain('임금 및 퇴직금 청구의 소')

      await validateFile(temp)
    })
  })

  describe('E. Table Cell Editing', () => {
    it('edits a table cell and cross-validates via HWP→HWPX conversion', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      const marker = 'TABLE_EDIT_CROSSVAL_2026'
      const editResult = await runCli(['table', 'edit', temp, 's0.t1.r0.c0', marker])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s0.t1.r0.c0')

      const textResult = await runCli(['text', temp])
      const textOutput = parseOutput(textResult) as any
      expect(textOutput.text).toContain(marker)

      await validateFile(temp)
      const found = await crossValidate(temp, marker)
      expect(found).toBe(true)
    })
  })

  describe('F. Cross-Validation', () => {
    it('edited text survives HWP→HWPX conversion round-trip', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p0 contains the document title
      const before_s0p0_cv = await runCli(['text', FIXTURE, 's0.p0'])
      expect((parseOutput(before_s0p0_cv) as any).text).toContain('임금 등 청구의 소')

      const marker = 'WAGE_CROSSVAL_2026'
      const editResult = await runCli(['edit', 'text', temp, 's0.p0', `[서식 예] ${marker}`])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)

      await validateFile(temp)
      const found = await crossValidate(temp, marker)
      expect(found).toBe(true)
    })
  })
})

describe.skipIf(!isViewerAvailable)('Z. Viewer Corruption Check', () => {
  it('edited file passes HWP Viewer corruption check', async () => {
    const temp = await tempCopy(FIXTURE)
    tempFiles.push(temp)
    await runCli(['edit', 'text', temp, 's0.p0', 'viewer-corruption-test'])
    const result = await checkViewerCorruption(temp)
    expect(result.corrupted).toBe(false)
    expect(result.skipped).toBe(false)
  }, 15_000)
})
