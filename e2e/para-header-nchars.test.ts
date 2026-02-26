import { afterEach, describe, expect, it } from 'bun:test'
import {
  cleanupFiles,
  crossValidate,
  FIXTURES,
  parseOutput,
  runCli,
  tempCopy,
  validateFile,
  verifyParaHeaderNChars,
} from './helpers'

const tempFiles: string[] = []

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('PARA_HEADER nChars consistency after editing', () => {
  it('nChars matches text length after editing shorter text (폭행죄 고소장)', async () => {
    const temp = await tempCopy(FIXTURES.assaultComplaint)
    tempFiles.push(temp)

    // given — s0.p0 has a title longer than the replacement
    const before = await runCli(['text', FIXTURES.assaultComplaint, 's0.p0'])
    const originalText = (parseOutput(before) as any).text
    expect(originalText.length).toBeGreaterThan(3)

    // when — replace with shorter text
    const editResult = await runCli(['edit', 'text', temp, 's0.p0', 'ABC'])
    expect((parseOutput(editResult) as any).success).toBe(true)

    // then — nChars matches actual PARA_TEXT length
    const { nChars, textLength, match } = await verifyParaHeaderNChars(temp, 0)
    expect(match).toBe(true)
    expect(nChars).toBe(textLength)
    await validateFile(temp)
  })

  it('nChars matches text length after editing longer text (폭행죄 고소장)', async () => {
    const temp = await tempCopy(FIXTURES.assaultComplaint)
    tempFiles.push(temp)

    // when — replace with much longer text
    const longText = '이것은 아주 긴 대체 텍스트입니다. This is a very long replacement paragraph for testing.'
    const editResult = await runCli(['edit', 'text', temp, 's0.p0', longText])
    expect((parseOutput(editResult) as any).success).toBe(true)

    // then — nChars matches actual PARA_TEXT length
    const { match } = await verifyParaHeaderNChars(temp, 0)
    expect(match).toBe(true)
    await validateFile(temp)
  })

  it('nChars matches after editing Korean text (피해자 의견 진술서)', async () => {
    const temp = await tempCopy(FIXTURES.victimStatement)
    tempFiles.push(temp)

    const editResult = await runCli(['edit', 'text', temp, 's0.p1', '사건번호: 2026-테스트-001'])
    expect((parseOutput(editResult) as any).success).toBe(true)

    const { match } = await verifyParaHeaderNChars(temp, 1)
    expect(match).toBe(true)
    await validateFile(temp)
  })

  it('nChars matches after editing employment rules (표준취업규칙)', async () => {
    const temp = await tempCopy(FIXTURES.employmentRules)
    tempFiles.push(temp)

    const editResult = await runCli(['edit', 'text', temp, 's0.p0', '수정된 취업규칙 제목'])
    expect((parseOutput(editResult) as any).success).toBe(true)

    const { match } = await verifyParaHeaderNChars(temp, 0)
    expect(match).toBe(true)
    await validateFile(temp)
  })

  it('edited text with correct nChars survives HWP→HWPX cross-validation', async () => {
    const temp = await tempCopy(FIXTURES.assaultComplaint)
    tempFiles.push(temp)

    const marker = 'NCHARS_CROSSVAL_2026'
    const editResult = await runCli(['edit', 'text', temp, 's0.p0', marker])
    expect((parseOutput(editResult) as any).success).toBe(true)

    // then — both structural integrity and content are correct
    const { match } = await verifyParaHeaderNChars(temp, 0)
    expect(match).toBe(true)
    await validateFile(temp)

    const found = await crossValidate(temp, marker)
    expect(found).toBe(true)
  })
})

describe('Z. Validation', () => {
  it('edited file passes validation', async () => {
    const temp = await tempCopy(FIXTURES.assaultComplaint)
    tempFiles.push(temp)
    await runCli(['edit', 'text', temp, 's0.p0', 'validation-test'])
    await validateFile(temp)
  })
})
