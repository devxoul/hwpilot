import { afterEach, describe, expect, it } from 'bun:test'
import { cleanupFiles, crossValidate, FIXTURES, parseOutput, runCli, tempCopy } from './helpers'

const FIXTURE = FIXTURES.assaultComplaint
const tempFiles: string[] = []

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Assault Complaint (폭행죄 고소장)', () => {
  describe('A. Document Structure', () => {
    it('reads as HWP format with 1 section', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.format).toBe('hwp')
      expect(doc.sections).toHaveLength(1)
    })

    it('has 69 level-0 paragraphs in section 0', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].paragraphs).toHaveLength(69)
    })

    it('has charShapes and paraShapes in header', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.header.charShapes.length).toBeGreaterThan(0)
      expect(doc.header.paraShapes.length).toBeGreaterThan(0)
    })

    it('detects 1 table via table list', async () => {
      const result = await runCli(['table', 'list', FIXTURE])
      const output = parseOutput(result) as any
      expect(Array.isArray(output)).toBe(true)
      expect(output).toHaveLength(1)
      expect(output[0].ref).toBe('s0.t0')
    })
  })

  describe('B. Criminal Law Content', () => {
    it('full text contains key criminal law terminology', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toContain('폭행죄')
      expect(text).toContain('고소장')
      expect(text).toContain('고소인')
      expect(text).toContain('피고소인')
      expect(text).toContain('폭행을 가한 사실')
    })

    it('s0.p0 is the document title', async () => {
      const paraResult = await runCli(['text', FIXTURE, 's0.p0'])
      const para = parseOutput(paraResult) as any
      expect(para.ref).toBe('s0.p0')
      expect(para.text).toContain('[서식 예] 폭행죄')
    })

    it('contains statutory references and penalty amounts', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toContain('형법 260조')
      expect(text).toContain('2년 이하의 징역')
      expect(text).toContain('500만원 이하의 벌금')
    })

    it('contains procedural information', async () => {
      const textResult = await runCli(['text', FIXTURE])
      const textOutput = parseOutput(textResult) as any
      const text = textOutput.text

      expect(text).toContain('공소시효')
      expect(text).toContain('반의사불벌죄')
    })
  })

  describe('C. Image Detection', () => {
    it('detects 3 images via read command', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      // Known issue: image metadata is corrupted (shared binDataPath, wrong dimensions)
      // but the count is correct
      expect(doc.sections[0].images).toHaveLength(3)
    })

    it('image list succeeds on HWP format', async () => {
      const result = await runCli(['image', 'list', FIXTURE])
      expect(result.exitCode).toBe(0)
      const images = JSON.parse(result.stdout)
      expect(images).toHaveLength(3)
      expect(images[0].ref).toBe('s0.img0')
    })
  })

  describe('D. Editing (Very Limited)', () => {
    it('edits s0.p0 title text', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p0 contains the document title
      const before_s0p0 = await runCli(['text', FIXTURE, 's0.p0'])
      expect((parseOutput(before_s0p0) as any).text).toContain('폭행죄')

      const newText = '[서식 예] 폭행죄 - 수정된 고소장'
      const editResult = await runCli(['edit', 'text', temp, 's0.p0', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s0.p0')
      expect(editOutput.text).toContain('수정된 고소장')

      const found = await crossValidate(temp, '수정된 고소장')
      expect(found).toBe(true)
    })
  })

  describe('E. Error Cases', () => {
    it('rejects edit on non-existent paragraph ref', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      const result = await runCli(['edit', 'text', temp, 's0.p200', 'invalid'])
      expect(result.exitCode).not.toBe(0)
    })

    it('rejects read on non-existent section', async () => {
      const result = await runCli(['text', FIXTURE, 's5.p0'])
      expect(result.exitCode).not.toBe(0)
    })
  })
})
