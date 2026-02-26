import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { cleanupFiles, crossValidate, FIXTURES, parseOutput, runCli, tempCopy, validateFile } from './helpers'

const FIXTURE = FIXTURES.wageClaim
const tempFiles: string[] = []

function tempPath(suffix: string, ext = '.hwp'): string {
  const p = join(tmpdir(), `e2e-para-add-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  tempFiles.push(p)
  return p
}

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Paragraph Add — HWPX (created document)', () => {
  describe('A. Basic Append (position end)', () => {
    it('adds a paragraph to end and paragraph count increases', async () => {
      const hwpxFile = tempPath('hwpx-append', '.hwpx')

      // given — create a blank HWPX
      await runCli(['create', hwpxFile])
      const beforeResult = await runCli(['read', hwpxFile, '--pretty'])
      const beforeDoc = parseOutput(beforeResult) as any
      const beforeCount = beforeDoc.sections[0].paragraphs.length

      // when — add a paragraph
      const addResult = await runCli(['paragraph', 'add', hwpxFile, 's0', 'New paragraph text', '--position', 'end'])
      const addOutput = parseOutput(addResult) as any
      expect(addOutput.success).toBe(true)

      // then — paragraph count increased
      const afterResult = await runCli(['read', hwpxFile, '--pretty'])
      const afterDoc = parseOutput(afterResult) as any
      expect(afterDoc.sections[0].paragraphs.length).toBe(beforeCount + 1)
    })

    it('new paragraph text is readable', async () => {
      const hwpxFile = tempPath('hwpx-readable', '.hwpx')
      await runCli(['create', hwpxFile])

      // when
      await runCli(['paragraph', 'add', hwpxFile, 's0', '읽기 테스트 문단', '--position', 'end'])

      // then
      const readResult = await runCli(['read', hwpxFile, '--pretty'])
      const doc = parseOutput(readResult) as any
      const paragraphs = doc.sections[0].paragraphs
      const lastParagraph = paragraphs[paragraphs.length - 1]
      expect(lastParagraph.runs[0].text).toBe('읽기 테스트 문단')
    })
  })

  describe('B. Insert Before/After', () => {
    it('inserts paragraph before existing paragraph', async () => {
      const hwpxFile = tempPath('hwpx-before', '.hwpx')
      await runCli(['create', hwpxFile])

      // given — add two paragraphs to have content
      await runCli(['paragraph', 'add', hwpxFile, 's0', 'FIRST', '--position', 'end'])
      await runCli(['paragraph', 'add', hwpxFile, 's0', 'SECOND', '--position', 'end'])

      // when — insert before s0.p0
      await runCli(['paragraph', 'add', hwpxFile, 's0.p0', 'INSERTED_BEFORE', '--position', 'before'])

      // then — INSERTED_BEFORE is now the first paragraph
      const readResult = await runCli(['read', hwpxFile, '--pretty'])
      const doc = parseOutput(readResult) as any
      const paragraphs = doc.sections[0].paragraphs
      const texts = paragraphs.map((p: any) => p.runs[0]?.text ?? '')
      expect(texts).toContain('INSERTED_BEFORE')
      const insertedIdx = texts.indexOf('INSERTED_BEFORE')
      const firstIdx = texts.indexOf('FIRST')
      expect(insertedIdx).toBeLessThan(firstIdx)
    })

    it('inserts paragraph after existing paragraph', async () => {
      const hwpxFile = tempPath('hwpx-after', '.hwpx')
      await runCli(['create', hwpxFile])

      // given — add two paragraphs
      await runCli(['paragraph', 'add', hwpxFile, 's0', 'ALPHA', '--position', 'end'])
      await runCli(['paragraph', 'add', hwpxFile, 's0', 'BETA', '--position', 'end'])

      // when — insert after first non-empty paragraph containing ALPHA
      // Find the ref for ALPHA
      const beforeRead = await runCli(['read', hwpxFile, '--pretty'])
      const beforeDoc = parseOutput(beforeRead) as any
      const alphaRef = beforeDoc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === 'ALPHA')?.ref
      expect(alphaRef).toBeDefined()

      await runCli(['paragraph', 'add', hwpxFile, alphaRef, 'INSERTED_AFTER', '--position', 'after'])

      // then — INSERTED_AFTER appears right after ALPHA
      const readResult = await runCli(['read', hwpxFile, '--pretty'])
      const doc = parseOutput(readResult) as any
      const texts = doc.sections[0].paragraphs.map((p: any) => p.runs[0]?.text ?? '')
      const alphaIdx = texts.indexOf('ALPHA')
      const insertedIdx = texts.indexOf('INSERTED_AFTER')
      expect(insertedIdx).toBe(alphaIdx + 1)
    })
  })

  describe('C. Existing Content Preservation', () => {
    it('adding paragraph does not corrupt existing paragraphs', async () => {
      const hwpxFile = tempPath('hwpx-preserve', '.hwpx')
      await runCli(['create', hwpxFile])

      // given — add initial content
      await runCli(['paragraph', 'add', hwpxFile, 's0', '기존 문단 하나', '--position', 'end'])
      await runCli(['paragraph', 'add', hwpxFile, 's0', '기존 문단 둘', '--position', 'end'])

      const beforeResult = await runCli(['read', hwpxFile, '--pretty'])
      const beforeDoc = parseOutput(beforeResult) as any
      const beforeTexts = beforeDoc.sections[0].paragraphs.map((p: any) => p.runs[0]?.text ?? '')

      // when — add another paragraph
      await runCli(['paragraph', 'add', hwpxFile, 's0', '새 문단', '--position', 'end'])

      // then — existing paragraphs unchanged
      const afterResult = await runCli(['read', hwpxFile, '--pretty'])
      const afterDoc = parseOutput(afterResult) as any
      const afterTexts = afterDoc.sections[0].paragraphs.map((p: any) => p.runs[0]?.text ?? '')

      for (const text of beforeTexts) {
        if (text) expect(afterTexts).toContain(text)
      }
      expect(afterTexts).toContain('새 문단')
    })
  })

  describe('D. XML Inspection', () => {
    it('added paragraph is present in raw HWPX XML', async () => {
      const hwpxFile = tempPath('hwpx-xml', '.hwpx')
      await runCli(['create', hwpxFile])

      const marker = 'HWPX_PARA_ADD_2026'
      await runCli(['paragraph', 'add', hwpxFile, 's0', marker, '--position', 'end'])

      // directly inspect the HWPX zip XML
      const data = await readFile(hwpxFile)
      const zip = await JSZip.loadAsync(data)
      const xml = await zip.file('Contents/section0.xml')?.async('string')
      expect(xml).toBeDefined()
      expect(xml).toContain(marker)
      expect(xml).toContain('hp:p')
    })
  })
})

describe('Paragraph Add — HWP fixture', () => {
  describe('A. Basic Append', () => {
    it('adds a paragraph to HWP and reads back', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — count existing paragraphs
      const beforeResult = await runCli(['read', temp, '--pretty'])
      const beforeDoc = parseOutput(beforeResult) as any
      const beforeCount = beforeDoc.sections[0].paragraphs.length

      // when — add a paragraph
      const addResult = await runCli(['paragraph', 'add', temp, 's0', 'HWP 추가 문단', '--position', 'end'])
      const addOutput = parseOutput(addResult) as any
      expect(addOutput.success).toBe(true)

      // then — paragraph count increased and text readable
      const afterResult = await runCli(['read', temp, '--pretty'])
      const afterDoc = parseOutput(afterResult) as any
      expect(afterDoc.sections[0].paragraphs.length).toBe(beforeCount + 1)

      const textResult = await runCli(['text', temp])
      const textOutput = parseOutput(textResult) as any
      expect(textOutput.text).toContain('HWP 추가 문단')

      await validateFile(temp)
    })
  })

  describe('B. Cross-Validation', () => {
    it('added paragraph survives HWP→HWPX conversion', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      const marker = 'PARA_ADD_CV_2026'
      await runCli(['paragraph', 'add', temp, 's0', marker, '--position', 'end'])

      await validateFile(temp)

      const found = await crossValidate(temp, marker)
      expect(found).toBe(true)
    })
  })

  describe('C. Existing Content Preservation', () => {
    it('adding a paragraph does not corrupt existing text', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — capture original text
      const beforeText = await runCli(['text', FIXTURE])
      parseOutput(beforeText) // ensure it parses without error

      // when
      await runCli(['paragraph', 'add', temp, 's0', 'PRESERVATION_CHECK', '--position', 'end'])

      // then — original text still present
      const afterText = await runCli(['text', temp])
      const afterOutput = parseOutput(afterText) as any
      expect(afterOutput.text).toContain('임금 등 청구의 소')
      expect(afterOutput.text).toContain('PRESERVATION_CHECK')
    })
  })
})

describe('Z. Validation', () => {
  it('HWP with added paragraph passes validation', async () => {
    const temp = await tempCopy(FIXTURE)
    tempFiles.push(temp)
    await runCli(['paragraph', 'add', temp, 's0', '뷰어 검증 문단', '--position', 'end'])
    await validateFile(temp)
  })
})
