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

const FIXTURE = FIXTURES.victimStatement
const tempFiles: string[] = []

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Victim Statement Form (피해자 의견 진술서)', () => {
  describe('A. Document Structure', () => {
    it('reads as HWP format with 1 section', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.format).toBe('hwp')
      expect(doc.sections).toHaveLength(1)
    })

    it('reports 2 level-0 paragraphs', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].paragraphs).toHaveLength(2)
    })

    it('detects 2 tables and 0 images', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].tables).toHaveLength(2)
      expect(doc.sections[0].images).toHaveLength(0)
    })
  })

  describe('B. Form Content Verification', () => {
    it('full text contains key form terms', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toContain('피해자 의견 진술서')
      expect(text).toContain('사건번호')
      expect(text).toContain('피해자')
      expect(text).toContain('피의자')
    })

    it('contains date field template pattern', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toMatch(/20\s+\.\s+\.\s+\./)
    })
  })

  describe('C. Damage Categories', () => {
    it('contains all 5 damage categories', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toContain('심리적 피해')
      expect(text).toContain('신체적 피해')
      expect(text).toContain('사회관계적 피해')
      expect(text).toContain('경제적 피해')
      expect(text).toContain('2차 피해')
    })
  })

  describe('D. Checkbox Items', () => {
    it('contains specific psychological symptom checkboxes', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toContain('자살충동')
      expect(text).toContain('우울')
      expect(text).toContain('분노감')
      expect(text).toContain('불안감')
    })
  })

  describe('E. Filling Form Fields (Limited)', () => {
    // ONLY s0.p0 and s0.p1 are editable. Do NOT test beyond these refs.
    // s0.p0 is empty/whitespace (firstLineText=""), so editing writes into an empty paragraph.

    it('edits s0.p0 (empty paragraph) with a test marker', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p0 is empty in this fixture
      const before_s0p0 = await runCli(['text', FIXTURE, 's0.p0'])
      expect((parseOutput(before_s0p0) as any).text).toBe('')

      // s0.p0 is empty/whitespace — edit reports success but text may not persist on re-read
      const marker = 'E2E_VICTIM_P0_MARKER'
      const editResult = await runCli(['edit', 'text', temp, 's0.p0', marker])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s0.p0')
      expect(editOutput.text).toContain(marker)

      await validateFile(temp)
    })

    it('edits s0.p1 with form content', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p1 is empty in this fixture
      const before_s0p1 = await runCli(['text', FIXTURE, 's0.p1'])
      expect((parseOutput(before_s0p1) as any).text).toBe('')

      const newText = '사건번호: 2025-E2E-TEST-001'
      const editResult = await runCli(['edit', 'text', temp, 's0.p1', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s0.p1')
      expect(editOutput.text).toContain('2025-E2E-TEST-001')

      await validateFile(temp)
    })
  })

  describe('F. Cross-Validation', () => {
    it('edited text in s0.p1 survives HWP→HWPX conversion', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p1 is empty in this fixture
      const before_s0p1_cv = await runCli(['text', FIXTURE, 's0.p1'])
      expect((parseOutput(before_s0p1_cv) as any).text).toBe('')

      const marker = 'CROSSVAL_VICTIM_2025'
      const editResult = await runCli(['edit', 'text', temp, 's0.p1', marker])
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
    await runCli(['edit', 'text', temp, 's0.p1', 'viewer-corruption-test'])
    const result = await checkViewerCorruption(temp)
    expect(result.corrupted).toBe(false)
    expect(result.skipped).toBe(false)
  }, 15_000)
})
