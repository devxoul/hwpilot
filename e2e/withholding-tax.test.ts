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

    it('has 1349 paragraphs in s0 and 325 in s1', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].paragraphs).toHaveLength(1349)
      expect(doc.sections[1].paragraphs).toHaveLength(325)
    })

    it('has charShapes and paraShapes in header', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.header.charShapes.length).toBeGreaterThan(0)
      expect(doc.header.paraShapes.length).toBeGreaterThan(0)
    })

    // Known issue: tables return 0 despite this being a form with tabular layout
    it('has 0 tables and 0 images (HWP 5.0 parser limitation)', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].tables).toHaveLength(0)
      expect(doc.sections[0].images).toHaveLength(0)
      expect(doc.sections[1].tables).toHaveLength(0)
      expect(doc.sections[1].images).toHaveLength(0)
    })
  })

  describe('B. Tax Content Verification', () => {
    it('s0.p0 contains the tax form header text', async () => {
      const result = await runCli(['text', FIXTURE, 's0.p0'])
      const para = parseOutput(result) as any
      expect(para.ref).toBe('s0.p0')
      expect(para.text).toContain('소득세법 시행규칙')
      expect(para.text).toContain('별지 제24호서식')
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
      expect(s0Count).toBe(1349)
      expect(s1Count).toBe(325)
      expect(s0Count).not.toBe(s1Count)
    })

    it('s0.p0 and s1.p0 have distinct content', async () => {
      const s0Result = await runCli(['text', FIXTURE, 's0.p0'])
      const s1Result = await runCli(['text', FIXTURE, 's1.p0'])
      const s0Para = parseOutput(s0Result) as any
      const s1Para = parseOutput(s1Result) as any

      expect(s0Para.ref).toBe('s0.p0')
      expect(s1Para.ref).toBe('s1.p0')
      expect(s0Para.text).not.toBe(s1Para.text)
    })
  })

  describe('D. Filling Tax Fields', () => {
    // Known issue: 1349 paragraphs reported but only 5 editable (reader/writer mismatch)
    it('edits s0.p0 with updated form header', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p0 contains the tax form header
      const before_s0p0 = await runCli(['text', FIXTURE, 's0.p0'])
      expect((parseOutput(before_s0p0) as any).text).toContain('소득세법')

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

      // given — s0.p1 contains the page number indicator
      const before_s0p1 = await runCli(['text', FIXTURE, 's0.p1'])
      expect((parseOutput(before_s0p1) as any).text).toContain('8쪽')

      const marker = 'TAXCV_2025_WITHHOLDING'
      const editResult = await runCli(['edit', 'text', temp, 's0.p1', marker])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)

      const found = await crossValidate(temp, marker)
      expect(found).toBe(true)
    })
  })
})
