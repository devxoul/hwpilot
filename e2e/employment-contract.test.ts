import { afterEach, describe, expect, it } from 'bun:test'
import {
  cleanupFiles,
  crossValidate,
  FIXTURES,
  parseOutput,
  runCli,
  tempCopy,
  validateFile,
} from './helpers'


const FIXTURE = FIXTURES.employmentContract
const tempFiles: string[] = []

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Employment Contract (개정 표준근로계약서)', () => {
  describe('A. Document Structure', () => {
    it('reads as HWP format with 1 section', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.format).toBe('hwp')
      expect(doc.sections).toHaveLength(1)
    })

    it('has 187 level-0 paragraphs in section 0', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].paragraphs).toHaveLength(187)
    })

    it('has charShapes and paraShapes in header', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.header.charShapes.length).toBeGreaterThan(0)
      expect(doc.header.paraShapes.length).toBeGreaterThan(0)
    })

    it('detects 10 tables in section 0', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].tables).toHaveLength(10)
    })

    it('has 0 images', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].images).toHaveLength(0)
    })
  })

  describe('B. Finding Contract Information', () => {
    it('full text contains all key contract terms', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toContain('표준근로계약서')
      expect(text).toContain('사업주')
      expect(text).toContain('근로자')
      expect(text).toContain('근로개시일')
      expect(text).toContain('근 무 장 소')
      expect(text).toContain('업무의 내용')
      expect(text).toContain('소정근로시간')
      expect(text).toContain('임금')
      expect(text).toContain('연차유급휴가')
    })

    it('s0.p0 is an empty level-0 paragraph', async () => {
      const paraResult = await runCli(['text', FIXTURE, 's0.p0'])
      const para = parseOutput(paraResult) as any
      expect(para.ref).toBe('s0.p0')
      expect(para.text).toBe('')
    })

    it('s0.p1 contains employer and employee labels', async () => {
      const paraResult = await runCli(['text', FIXTURE, 's0.p1'])
      const para = parseOutput(paraResult) as any
      expect(para.text).toContain('사업주')
      expect(para.text).toContain('근로자')
    })

    it('contains multiple contract types', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toContain('기간의 정함이 없는 경우')
      expect(text).toContain('기간의 정함이 있는 경우')
      expect(text).toContain('연소근로자')
    })
  })

  describe('C. Filling Form Fields', () => {
    it('fills employer name in s0.p1', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p1 contains employer/employee template
      const before_s0p1 = await runCli(['text', FIXTURE, 's0.p1'])
      expect((parseOutput(before_s0p1) as any).text).toContain('사업주')

      const newText =
        '(주)테스트코리아(이하 "사업주"라 함)과(와) 홍길동(이하 "근로자"라 함)은 다음과 같이 근로계약을 체결한다.'
      const editResult = await runCli(['edit', 'text', temp, 's0.p1', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s0.p1')
      expect(editOutput.text).toContain('(주)테스트코리아')

      await validateFile(temp)

      const found = await crossValidate(temp, '(주)테스트코리아')
      expect(found).toBe(true)
    })

    it('fills start date in s0.p2', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p2 contains start date template
      const before_s0p2 = await runCli(['text', FIXTURE, 's0.p2'])
      expect((parseOutput(before_s0p2) as any).text).toContain('근로개시일')

      const newText = '1. 근로개시일 : 2025년 3월 1일부터'
      const editResult = await runCli(['edit', 'text', temp, 's0.p2', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.text).toContain('2025년 3월 1일')

      await validateFile(temp)

      const found = await crossValidate(temp, '2025년 3월 1일')
      expect(found).toBe(true)
    })

    it('fills workplace in s0.p3', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p3 contains workplace template
      const before_s0p3 = await runCli(['text', FIXTURE, 's0.p3'])
      expect((parseOutput(before_s0p3) as any).text).toContain('근 무 장 소')

      const newText = '2. 근 무 장 소 : 서울특별시 강남구 테헤란로 123'
      const editResult = await runCli(['edit', 'text', temp, 's0.p3', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.text).toContain('서울특별시 강남구')

      await validateFile(temp)

      const found = await crossValidate(temp, '서울특별시 강남구')
      expect(found).toBe(true)
    })

    it('fills job description in s0.p4', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p4 contains job description template
      const before_s0p4 = await runCli(['text', FIXTURE, 's0.p4'])
      expect((parseOutput(before_s0p4) as any).text).toContain('업무의 내용')

      const newText = '3. 업무의 내용 : 소프트웨어 개발 및 AI 서비스 구현'
      const editResult = await runCli(['edit', 'text', temp, 's0.p4', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.text).toContain('소프트웨어 개발')

      await validateFile(temp)

      const found = await crossValidate(temp, '소프트웨어 개발')
      expect(found).toBe(true)
    })
  })

  describe('D. Cross-Validation', () => {
    it('edited text survives HWP→HWPX conversion round-trip', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p2 contains start date template
      const before_s0p2_cv = await runCli(['text', FIXTURE, 's0.p2'])
      expect((parseOutput(before_s0p2_cv) as any).text).toContain('근로개시일')

      const marker = 'CROSSVAL_2025_0301'
      const editResult = await runCli(['edit', 'text', temp, 's0.p2', `1. 근로개시일 : ${marker}`])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)

      await validateFile(temp)
      const found = await crossValidate(temp, marker)
      expect(found).toBe(true)
    })
  })

  describe('E. Format Editing', () => {
    it('applies bold formatting to s0.p0 title', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      const formatResult = await runCli(['edit', 'format', temp, 's0.p0', '--bold'])
      const formatOutput = parseOutput(formatResult) as any
      expect(formatOutput.success).toBe(true)
      expect(formatOutput.format.bold).toBe(true)

      await validateFile(temp)
    })
  })
})

describe('Z. Validation', () => {
  it('edited file passes validation', async () => {
    const temp = await tempCopy(FIXTURE)
    tempFiles.push(temp)
    await runCli(['edit', 'text', temp, 's0.p0', 'validation-test'])
    await validateFile(temp)
  })
})
