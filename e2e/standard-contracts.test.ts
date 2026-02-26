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

const FIXTURE = FIXTURES.standardContracts
const tempFiles: string[] = []

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Standard Contracts 7-Type (표준 근로계약서 7종)', () => {
  describe('A. Document Structure', () => {
    it('reads as HWP format with 1 section', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.format).toBe('hwp')
      expect(doc.sections).toHaveLength(1)
    })

    it('has 181 level-0 paragraphs in section 0', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].paragraphs).toHaveLength(181)
    })

    it('has charShapes and paraShapes in header', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.header.charShapes.length).toBeGreaterThan(0)
      expect(doc.header.paraShapes.length).toBeGreaterThan(0)
    })

    it('detects 14 tables in section 0', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].tables).toHaveLength(14)
    })

    it('has 0 images', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].images).toHaveLength(0)
    })
  })

  describe('B. All 7 Contract Types Present', () => {
    it('contains all 7 contract type titles in full text', async () => {
      const result = await runCli(['text', FIXTURE])
      const { text } = parseOutput(result) as any

      expect(text).toContain('표준근로계약서(기간의 정함이 없는 경우)')
      expect(text).toContain('표준근로계약서(기간의 정함이 있는 경우)')
      expect(text).toContain('연소근로자(18세 미만인 자) 표준근로계약서')
      expect(text).toContain('건설일용근로자 표준근로계약서')
      expect(text).toContain('단시간근로자 표준근로계약서')
      expect(text).toContain('Standard Labor Contract')
      expect(text).toContain('표준근로계약서(농업ㆍ축산업ㆍ어업 분야)')
    })

    it('s0.p0 is an empty level-0 paragraph', async () => {
      const result = await runCli(['text', FIXTURE, 's0.p0'])
      const para = parseOutput(result) as any
      expect(para.ref).toBe('s0.p0')
      expect(para.text).toBe('')
    })
  })

  describe('C. Contract-Type-Specific Content', () => {
    it('minor worker contract references age restriction (18세 미만)', async () => {
      const result = await runCli(['text', FIXTURE])
      const { text } = parseOutput(result) as any

      expect(text).toContain('18세 미만')
      expect(text).toContain('친권자')
      expect(text).toContain('후견인')
    })

    it('part-time contract references schedule details', async () => {
      const result = await runCli(['text', FIXTURE])
      const { text } = parseOutput(result) as any

      expect(text).toContain('단시간근로자')
      expect(text).toContain('통상임금의 100분의 50%이상의 가산임금')
    })

    it('agriculture contract includes sector-specific fields', async () => {
      const result = await runCli(['text', FIXTURE])
      const { text } = parseOutput(result) as any

      expect(text).toContain('농업')
      expect(text).toContain('축산업')
      expect(text).toContain('어업')
      expect(text).toContain('Standard Labor Contract(For Agriculture, Livestock and Fishery Sectors)')
    })

    it('all contract types share common employment fields', async () => {
      const result = await runCli(['text', FIXTURE])
      const { text } = parseOutput(result) as any

      expect(text).toContain('근로개시일')
      expect(text).toContain('근 무 장 소')
      expect(text).toContain('업무의 내용')
      expect(text).toContain('소정근로시간')
      expect(text).toContain('임금')
      expect(text).toContain('연차유급휴가')
      expect(text).toContain('사회보험')
    })
  })

  describe('D. Filling Form Fields', () => {
    it('fills employer/employee info in s0.p1', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p1 contains employer/employee template
      const before_s0p1 = await runCli(['text', FIXTURE, 's0.p1'])
      expect((parseOutput(before_s0p1) as any).text).toContain('사업주')

      const newText =
        '(주)표준코리아(이하 "사업주"라 함)과(와) 김철수(이하 "근로자"라 함)은 다음과 같이 근로계약을 체결한다.'
      const editResult = await runCli(['edit', 'text', temp, 's0.p1', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s0.p1')
      expect(editOutput.text).toContain('(주)표준코리아')

      await validateFile(temp)

      const found = await crossValidate(temp, '(주)표준코리아')
      expect(found).toBe(true)
    })

    it('fills start date in s0.p2', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p2 contains start date template
      const before_s0p2 = await runCli(['text', FIXTURE, 's0.p2'])
      expect((parseOutput(before_s0p2) as any).text).toContain('근로개시일')

      const newText = '1. 근로개시일 : 2024년 7월 1일부터'
      const editResult = await runCli(['edit', 'text', temp, 's0.p2', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.text).toContain('2024년 7월 1일')

      await validateFile(temp)

      const found = await crossValidate(temp, '2024년 7월 1일')
      expect(found).toBe(true)
    })

    it('fills workplace in s0.p3', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p3 contains workplace template
      const before_s0p3 = await runCli(['text', FIXTURE, 's0.p3'])
      expect((parseOutput(before_s0p3) as any).text).toContain('근 무 장 소')

      const newText = '2. 근 무 장 소 : 부산광역시 해운대구 센텀로 55'
      const editResult = await runCli(['edit', 'text', temp, 's0.p3', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.text).toContain('부산광역시 해운대구')

      await validateFile(temp)

      const found = await crossValidate(temp, '부산광역시 해운대구')
      expect(found).toBe(true)
    })
  })

  describe('E. Cross-Validation', () => {
    it('edited text survives HWP→HWPX conversion round-trip', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p4 contains job description template
      const before_s0p4 = await runCli(['text', FIXTURE, 's0.p4'])
      expect((parseOutput(before_s0p4) as any).text).toContain('업무의 내용')

      const marker = 'STDCONTRACT_CROSSVAL_2024'
      const editResult = await runCli(['edit', 'text', temp, 's0.p4', `3. 업무의 내용 : ${marker}`])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)

      await validateFile(temp)
      const found = await crossValidate(temp, marker)
      expect(found).toBe(true)
    })
  })

  describe('F. Comparison with 2025 Version', () => {
    it('shares common field names with 2025 version but is a different document', async () => {
      const result2019 = await runCli(['text', FIXTURES.standardContracts])
      const result2025 = await runCli(['text', FIXTURES.employmentContract])
      const text2019 = (parseOutput(result2019) as any).text
      const text2025 = (parseOutput(result2025) as any).text

      expect(text2019).toContain('근로개시일')
      expect(text2025).toContain('근로개시일')
      expect(text2019).toContain('업무의 내용')
      expect(text2025).toContain('업무의 내용')
      expect(text2019).toContain('소정근로시간')
      expect(text2025).toContain('소정근로시간')

      expect(text2019).toContain('Standard Labor Contract')
      expect(text2019).toContain('농업ㆍ축산업ㆍ어업')

      expect(text2019.length).toBeGreaterThan(text2025.length)
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
