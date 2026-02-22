import { afterEach, describe, expect, it } from 'bun:test'
import { cleanupFiles, crossValidate, FIXTURES, parseOutput, runCli, tempCopy } from './helpers'

const FIXTURE = FIXTURES.withholdingTax
const tempFiles: string[] = []

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Withholding Tax Receipt (근로소득원천징수영수증)', () => {
  describe('A. Document Structure', () => {
    it('reads as HWP format with 2 sections', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.format).toBe('hwp')
      expect(doc.sections).toHaveLength(2)
    })

    it('has 5 level-0 paragraphs in s0 and 1 in s1', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].paragraphs).toHaveLength(5)
      expect(doc.sections[1].paragraphs).toHaveLength(1)
    })

    it('has charShapes and paraShapes in header', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.header.charShapes.length).toBeGreaterThan(0)
      expect(doc.header.paraShapes.length).toBeGreaterThan(0)
    })

    it('detects tables per section (s0:11, s1:4) and 0 images', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].tables).toHaveLength(11)
      expect(doc.sections[0].images).toHaveLength(0)
      expect(doc.sections[1].tables).toHaveLength(4)
      expect(doc.sections[1].images).toHaveLength(0)
    })
  })

  describe('B. Tax Content Verification', () => {
    it('s0.p0 is an empty level-0 paragraph', async () => {
      const result = await runCli(['text', FIXTURE, 's0.p0'])
      const para = parseOutput(result) as any
      expect(para.ref).toBe('s0.p0')
      expect(para.text).toBe('')
    })

    it('full text contains key tax form terms', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toContain('근로소득 원천징수영수증')
      expect(text).toContain('소득자')
      expect(text).toContain('근무처')
      expect(text).toContain('급여')
    })
  })

  describe('C. Two-Section Read', () => {
    it('reads both sections with distinct paragraph counts', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      const s0Count = doc.sections[0].paragraphs.length
      const s1Count = doc.sections[1].paragraphs.length
      expect(s0Count).toBe(5)
      expect(s1Count).toBe(1)
      expect(s0Count).not.toBe(s1Count)
    })

    it('s0 and s1 section text contain distinct content', async () => {
      const s0Result = await runCli(['text', FIXTURE, 's0'])
      const s1Result = await runCli(['text', FIXTURE, 's1'])
      const s0Para = parseOutput(s0Result) as any
      const s1Para = parseOutput(s1Result) as any

      expect(s0Para.ref).toBe('s0')
      expect(s1Para.ref).toBe('s1')
      expect(s0Para.text).toContain('소득세법 시행규칙')
      expect(s0Para.text).not.toBe(s1Para.text)
    })
  })

  describe('D. Filling Tax Fields', () => {
    // Known issue: most visible text lives in nested structures, not level-0 paragraphs.
    it('edits s0.p0 with updated form header', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p0 is empty in this fixture
      const before_s0p0 = await runCli(['text', FIXTURE, 's0.p0'])
      expect((parseOutput(before_s0p0) as any).text).toBe('')

      const newText = '■ 소득세법 시행규칙 [별지 제24호서식(1)] <개정안 2025. 01.>'
      const editResult = await runCli(['edit', 'text', temp, 's0.p0', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s0.p0')
      expect(editOutput.text).toContain('2025. 01.')
    })

    it('edits s1.p0 in the second section', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s1.p0 is empty in this fixture
      const before_s1p0 = await runCli(['text', FIXTURE, 's1.p0'])
      expect((parseOutput(before_s1p0) as any).text).toBe('')

      const editResult = await runCli(['edit', 'text', temp, 's1.p0', '제2장 세액계산 테스트'])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s1.p0')
      expect(editOutput.text).toContain('세액계산 테스트')
    })
  })

  describe('E. Cross-Validation', () => {
    it('edited text in s0 survives HWP→HWPX conversion', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p1 is empty in this fixture
      const before_s0p1 = await runCli(['text', FIXTURE, 's0.p1'])
      expect((parseOutput(before_s0p1) as any).text).toBe('')

      const marker = 'TAXCV_2025_WITHHOLDING'
      const editResult = await runCli(['edit', 'text', temp, 's0.p1', marker])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)

      const found = await crossValidate(temp, marker)
      expect(found).toBe(true)
    })
  })
})
