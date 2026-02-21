import { afterEach, describe, expect, it } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import JSZip from 'jszip'
import { cleanupFiles, crossValidate, FIXTURES, parseOutput, runCli, tempCopy } from './helpers'

const FIXTURE = FIXTURES.employmentRules
const tempFiles: string[] = []

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Employment Rules (개정 표준취업규칙)', () => {
  describe('A. Document Structure', () => {
    it('reads as HWP format with 4 sections', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.format).toBe('hwp')
      expect(doc.sections).toHaveLength(4)
    })

    it('has expected paragraph counts per section', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.sections[0].paragraphs).toHaveLength(23)
      expect(doc.sections[1].paragraphs).toHaveLength(2109)
      expect(doc.sections[2].paragraphs).toHaveLength(206)
      expect(doc.sections[3].paragraphs).toHaveLength(7)
    })

    it('has charShapes and paraShapes in header', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      expect(doc.header.charShapes.length).toBeGreaterThan(0)
      expect(doc.header.paraShapes.length).toBeGreaterThan(0)
    })

    it('has 0 tables and 0 images across all sections', async () => {
      // tables=0 despite tabular content in text (HWP 5.0 parser limitation)
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      for (const section of doc.sections) {
        expect(section.tables).toHaveLength(0)
        expect(section.images).toHaveLength(0)
      }
    })
  })

  describe('B. Multi-Section Content', () => {
    it('each section has distinct content', async () => {
      // s0.p0 and s1.p0 are both empty — use later paragraphs with actual text
      const refs = ['s0.p3', 's1.p4', 's2.p0', 's3.p0']
      const texts: string[] = []
      for (const ref of refs) {
        const result = await runCli(['text', FIXTURE, ref])
        const output = parseOutput(result) as any
        expect(output.ref).toBe(ref)
        texts.push(output.text)
      }

      const unique = new Set(texts)
      expect(unique.size).toBe(refs.length)
    })

    it('section 1 (main body) has significantly more paragraphs than others', async () => {
      const result = await runCli(['read', FIXTURE])
      const doc = parseOutput(result) as any
      const s1Count = doc.sections[1].paragraphs.length
      expect(s1Count).toBeGreaterThan(doc.sections[0].paragraphs.length)
      expect(s1Count).toBeGreaterThan(doc.sections[2].paragraphs.length)
      expect(s1Count).toBeGreaterThan(doc.sections[3].paragraphs.length)
    })
  })

  describe('C. Text Extraction', () => {
    it('full text contains key employment rules terms', async () => {
      const result = await runCli(['text', FIXTURE])
      const output = parseOutput(result) as any
      const text = output.text

      expect(text).toContain('취업규칙')
      expect(text).toContain('근로시간')
      expect(text).toContain('휴일')
      expect(text).toContain('임금')
      expect(text).toContain('퇴직')
    })

    it('can read specific paragraphs from different sections', async () => {
      const s0p1 = await runCli(['text', FIXTURE, 's0.p1'])
      const s0p1Output = parseOutput(s0p1) as any
      expect(s0p1Output.ref).toBe('s0.p1')
      expect(typeof s0p1Output.text).toBe('string')

      const s2p3 = await runCli(['text', FIXTURE, 's2.p3'])
      const s2p3Output = parseOutput(s2p3) as any
      expect(s2p3Output.ref).toBe('s2.p3')
      expect(typeof s2p3Output.text).toBe('string')
    })
  })

  describe('D. Editing Across Sections', () => {
    it('edits s0.p0 in section 0', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p0 is empty in this fixture
      const before_s0p0 = await runCli(['text', FIXTURE, 's0.p0'])
      expect((parseOutput(before_s0p0) as any).text).toBe('')

      const marker = 'E2E_S0_EDIT_MARKER'
      const editResult = await runCli(['edit', 'text', temp, 's0.p0', marker])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s0.p0')
      expect(editOutput.text).toContain(marker)

      const readResult = await runCli(['text', temp, 's0.p0'])
      const readOutput = parseOutput(readResult) as any
      expect(readOutput.text).toContain(marker)
    })

    it('edits s1.p0 in section 1', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s1.p0 is empty in this fixture
      const before_s1p0 = await runCli(['text', FIXTURE, 's1.p0'])
      expect((parseOutput(before_s1p0) as any).text).toBe('')

      const marker = 'E2E_S1_EDIT_MARKER'
      const editResult = await runCli(['edit', 'text', temp, 's1.p0', marker])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s1.p0')
      expect(editOutput.text).toContain(marker)
    })

    it('edits multiple paragraphs in s2', async () => {
      // s2 edits succeed but don't persist on HWP re-read; verify via HWPX cross-validation
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s2.p0 contains section header
      const before_s2p0 = await runCli(['text', FIXTURE, 's2.p0'])
      expect((parseOutput(before_s2p0) as any).text).toContain('별지 1')

      const marker0 = 'S2P0_EDITED'
      const marker5 = 'S2P5_EDITED'

      const edit0 = await runCli(['edit', 'text', temp, 's2.p0', marker0])
      expect((parseOutput(edit0) as any).success).toBe(true)
      expect((parseOutput(edit0) as any).text).toContain(marker0)

      // given — s2.p5 contains workplace field
      const before_s2p5 = await runCli(['text', FIXTURE, 's2.p5'])
      expect((parseOutput(before_s2p5) as any).text).toContain('근 무 장 소')

      const edit5 = await runCli(['edit', 'text', temp, 's2.p5', marker5])
      expect((parseOutput(edit5) as any).success).toBe(true)
      expect((parseOutput(edit5) as any).text).toContain(marker5)
    })

    it('edits s3.p0 in section 3', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s3.p0 contains appendix header
      const before_s3p0 = await runCli(['text', FIXTURE, 's3.p0'])
      expect((parseOutput(before_s3p0) as any).text).toContain('별첨')

      const marker = 'E2E_S3_EDIT_MARKER'
      const editResult = await runCli(['edit', 'text', temp, 's3.p0', marker])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s3.p0')
      expect(editOutput.text).toContain(marker)
    })
  })

  describe('E. Cross-Validation', () => {
    it('s0 edit survives HWP→HWPX conversion (section0.xml)', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p0 is empty in this fixture
      const before_s0p0_cv = await runCli(['text', FIXTURE, 's0.p0'])
      expect((parseOutput(before_s0p0_cv) as any).text).toBe('')

      const marker = 'CROSSVAL_S0_RULES'
      const editResult = await runCli(['edit', 'text', temp, 's0.p0', marker])
      expect((parseOutput(editResult) as any).success).toBe(true)

      // crossValidate checks section0.xml
      const found = await crossValidate(temp, marker)
      expect(found).toBe(true)
    })

    it('s1 edit survives HWP→HWPX conversion (section1.xml)', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s1.p0 is empty in this fixture
      const before_s1p0_cv = await runCli(['text', FIXTURE, 's1.p0'])
      expect((parseOutput(before_s1p0_cv) as any).text).toBe('')

      const marker = 'CROSSVAL_S1_RULES'
      const editResult = await runCli(['edit', 'text', temp, 's1.p0', marker])
      expect((parseOutput(editResult) as any).success).toBe(true)

      // Manual section1.xml inspection since crossValidate only checks section0.xml
      const hwpxPath = `${temp}.${Date.now()}.tmp.hwpx`
      tempFiles.push(hwpxPath)
      await runCli(['convert', temp, hwpxPath])
      try {
        const data = await readFile(hwpxPath)
        const zip = await JSZip.loadAsync(data)
        const xml = zip.file('Contents/section1.xml')
        expect(xml).not.toBeNull()
        const content = await xml!.async('string')
        expect(content).toContain(marker)
      } finally {
        await rm(hwpxPath, { force: true })
      }
    })

    it('edits in s0 and s2 both appear in converted HWPX', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — s0.p0 is empty in this fixture
      const before_s0p0_dual = await runCli(['text', FIXTURE, 's0.p0'])
      expect((parseOutput(before_s0p0_dual) as any).text).toBe('')

      // given — s2.p0 contains section header
      const before_s2p0_dual = await runCli(['text', FIXTURE, 's2.p0'])
      expect((parseOutput(before_s2p0_dual) as any).text).toContain('별지 1')

      const markerS0 = 'DUAL_CROSSVAL_S0'
      const markerS2 = 'DUAL_CROSSVAL_S2'

      const edit0 = await runCli(['edit', 'text', temp, 's0.p0', markerS0])
      expect((parseOutput(edit0) as any).success).toBe(true)
      const edit2 = await runCli(['edit', 'text', temp, 's2.p0', markerS2])
      expect((parseOutput(edit2) as any).success).toBe(true)

      const hwpxPath = `${temp}.${Date.now()}.dual.tmp.hwpx`
      tempFiles.push(hwpxPath)
      await runCli(['convert', temp, hwpxPath])
      try {
        const data = await readFile(hwpxPath)
        const zip = await JSZip.loadAsync(data)

        const xml0 = zip.file('Contents/section0.xml')
        expect(xml0).not.toBeNull()
        const content0 = await xml0!.async('string')
        expect(content0).toContain(markerS0)

        const xml2 = zip.file('Contents/section2.xml')
        expect(xml2).not.toBeNull()
        const content2 = await xml2!.async('string')
        expect(content2).toContain(markerS2)
      } finally {
        await rm(hwpxPath, { force: true })
      }
    })
  })
})
