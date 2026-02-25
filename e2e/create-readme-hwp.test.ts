import { afterEach, describe, expect, it } from 'bun:test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { checkViewerCorruption, isHwpViewerAvailable, parseOutput, runCli } from './helpers'

const isViewerAvailable = await isHwpViewerAvailable()

const tempFiles: string[] = []

function tempPath(suffix = ''): string {
  const path = join(tmpdir(), `e2e-readme-hwp-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`)
  tempFiles.push(path)
  return path
}

async function generateReadmeHwp(filePath: string): Promise<void> {
  const { createHwp } = await import('../src/formats/hwp/creator')
  const paragraphs: import('../src/formats/hwp/creator').ParagraphInput[] = [
    { text: 'hwpilot', bold: true, fontSize: 22 },
    { text: '' },
    { text: 'Hwpilot은 AI 에이전트가 HWP/HWPX를 쉽게 다룰 수 있게 해주는 도구입니다.' },
    { text: '' },
    { text: '배경', bold: true, fontSize: 16 },
    { text: 'HWP는 여전히 한국에서 가장 많이 사용되는 문서 포맷입니다.' },
    { text: '' },
    { text: '주요 기능', bold: true, fontSize: 16 },
    { text: '• 읽기 & 검색 — 문단, 표, 텍스트 박스, 이미지를 읽고 검색' },
    { text: '• 텍스트 편집 — 문단, 표 셀, 텍스트 박스의 텍스트를 직접 수정' },
    { text: '• 서식 편집 — 굵게, 기울임, 밑줄, 글꼴, 크기, 색상 변경' },
    { text: '' },
    { text: '설치', bold: true, fontSize: 16 },
    { text: 'npm install -g hwpilot' },
    { text: '' },
    { text: '라이선스', bold: true, fontSize: 16 },
    { text: 'MIT' },
  ]
  const buffer = await createHwp({ paragraphs, fontSize: 1000 })
  await writeFile(filePath, buffer)
}

type CharShapeInfo = { bold: boolean; fontSize: number }

// Read CHAR_SHAPE records from DocInfo and PARA_CHAR_SHAPE refs from Section0
async function readBinaryCharShapes(
  hwpPath: string,
): Promise<{ charShapes: CharShapeInfo[]; paraCharShapeRefs: number[] }> {
  const CFB = (await import('cfb')).default
  const { decompressStream } = await import('../src/formats/hwp/stream-util')
  const { iterateRecords } = await import('../src/formats/hwp/record-parser')
  const { TAG } = await import('../src/formats/hwp/tag-ids')

  const buf = await readFile(hwpPath)
  const cfb = CFB.read(buf, { type: 'buffer' })

  const fh = CFB.find(cfb, '/FileHeader')
  const compressed = fh?.content ? (Buffer.from(fh.content).readUInt32LE(36) & 0x1) !== 0 : false

  // -- DocInfo: collect CHAR_SHAPE records --
  const docInfoEntry = CFB.find(cfb, '/DocInfo')
  let docStream = Buffer.from(docInfoEntry!.content!)
  if (compressed) docStream = Buffer.from(decompressStream(docStream))

  const charShapes: CharShapeInfo[] = []
  for (const { header, data } of iterateRecords(docStream)) {
    if (header.tagId === TAG.CHAR_SHAPE && data.length >= 50) {
      const fontSize = data.readUInt32LE(42)
      const attrs = data.readUInt32LE(46)
      charShapes.push({ bold: (attrs & 0x1) !== 0, fontSize })
    }
  }

  // -- Section0: collect per-paragraph charShape refs --
  const sectionEntry = CFB.find(cfb, '/BodyText/Section0')
  let secStream = Buffer.from(sectionEntry!.content!)
  if (compressed) secStream = Buffer.from(decompressStream(secStream))

  const paraCharShapeRefs: number[] = []
  let expectingCharShape = false
  for (const { header, data } of iterateRecords(secStream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      expectingCharShape = true
      continue
    }
    // PARA_CHAR_SHAPE: array of (position:u32, charShapeRef:u32) pairs
    if (header.tagId === TAG.PARA_CHAR_SHAPE && expectingCharShape) {
      // first entry's charShapeRef at offset 4
      const ref = data.length >= 8 ? data.readUInt32LE(4) : 0
      paraCharShapeRefs.push(ref)
      expectingCharShape = false
    }
  }

  return { charShapes, paraCharShapeRefs }
}

afterEach(async () => {
  for (const f of tempFiles) {
    await rm(f, { force: true })
  }
  tempFiles.length = 0
})

describe('README → HWP Creation with Formatting', () => {
  describe('A. Content Integrity', () => {
    it('generates HWP with correct paragraph count', async () => {
      const file = tempPath('.hwp')
      await generateReadmeHwp(file)

      const result = await runCli(['read', file])
      const doc = parseOutput(result) as any
      expect(doc.format).toBe('hwp')
      expect(doc.sections).toHaveLength(1)
      expect(doc.sections[0].paragraphs).toHaveLength(17)
    })

    it('title paragraph contains "hwpilot"', async () => {
      const file = tempPath('.hwp')
      await generateReadmeHwp(file)

      const result = await runCli(['text', file, 's0.p0'])
      const output = parseOutput(result) as any
      expect(output.text).toBe('hwpilot')
    })

    it('heading paragraphs contain correct Korean text', async () => {
      const file = tempPath('.hwp')
      await generateReadmeHwp(file)

      // given — headings at known positions
      const headings = [
        { ref: 's0.p4', text: '배경' },
        { ref: 's0.p7', text: '주요 기능' },
        { ref: 's0.p12', text: '설치' },
        { ref: 's0.p15', text: '라이선스' },
      ]

      for (const h of headings) {
        const result = await runCli(['text', file, h.ref])
        const output = parseOutput(result) as any
        expect(output.text).toBe(h.text)
      }
    })

    it('body paragraphs contain expected content', async () => {
      const file = tempPath('.hwp')
      await generateReadmeHwp(file)

      const result = await runCli(['text', file])
      const output = parseOutput(result) as any
      expect(output.text).toContain('AI 에이전트')
      expect(output.text).toContain('npm install -g hwpilot')
      expect(output.text).toContain('MIT')
    })
  })

  describe('B. CharShape Formatting Verification (binary level)', () => {
    it('title has bold=true and fontSize=22 in binary PARA_CHAR_SHAPE', async () => {
      const file = tempPath('.hwp')
      await generateReadmeHwp(file)

      const { charShapes, paraCharShapeRefs } = await readBinaryCharShapes(file)
      const titleRef = paraCharShapeRefs[0]
      const titleCharShape = charShapes[titleRef]
      expect(titleCharShape.bold).toBe(true)
      expect(titleCharShape.fontSize).toBe(2200)
    })

    it('section headings have bold=true and fontSize=16 in binary', async () => {
      const file = tempPath('.hwp')
      await generateReadmeHwp(file)

      const { charShapes, paraCharShapeRefs } = await readBinaryCharShapes(file)
      // given — heading paragraph indices
      const headingIndices = [4, 7, 12, 15]
      for (const idx of headingIndices) {
        const ref = paraCharShapeRefs[idx]
        const cs = charShapes[ref]
        expect(cs.bold).toBe(true)
        expect(cs.fontSize).toBe(1600)
      }
    })

    it('body paragraphs use base charShape (not bold) in binary', async () => {
      const file = tempPath('.hwp')
      await generateReadmeHwp(file)

      const { charShapes, paraCharShapeRefs } = await readBinaryCharShapes(file)
      // given — body paragraph indices (non-empty, non-heading)
      const bodyIndices = [2, 5, 8, 9, 10, 13, 16]
      for (const idx of bodyIndices) {
        const ref = paraCharShapeRefs[idx]
        const cs = charShapes[ref]
        expect(cs.bold).toBe(false)
      }
    })
  })

  describe('C. ID_MAPPINGS Structural Integrity', () => {
    it('ID_MAPPINGS charShape count matches actual CHAR_SHAPE records', async () => {
      const file = tempPath('.hwp')
      await generateReadmeHwp(file)

      const CFB = (await import('cfb')).default
      const { decompressStream } = await import('../src/formats/hwp/stream-util')
      const { iterateRecords } = await import('../src/formats/hwp/record-parser')
      const { TAG } = await import('../src/formats/hwp/tag-ids')

      const buf = await readFile(file)
      const cfb = CFB.read(buf, { type: 'buffer' })

      const fh = CFB.find(cfb, '/FileHeader')
      const compressed = fh?.content ? (Buffer.from(fh.content).readUInt32LE(36) & 0x1) !== 0 : false

      const docInfoEntry = CFB.find(cfb, '/DocInfo')
      expect(docInfoEntry?.content).toBeTruthy()
      let stream = Buffer.from(docInfoEntry!.content!)
      if (compressed) stream = Buffer.from(decompressStream(stream))

      let actualCharShapeCount = 0
      let idMappingsCharShapeCount = -1

      for (const { header, data } of iterateRecords(stream)) {
        if (header.tagId === TAG.ID_MAPPINGS && data.length >= 40) {
          idMappingsCharShapeCount = data.readUInt32LE(36)
        }
        if (header.tagId === TAG.CHAR_SHAPE) {
          actualCharShapeCount++
        }
      }

      expect(idMappingsCharShapeCount).toBeGreaterThan(0)
      expect(idMappingsCharShapeCount).toBe(actualCharShapeCount)
    })
  })

  describe('D. Cross-validation via HWP→HWPX Convert', () => {
    it('converts to HWPX without error', async () => {
      const hwpFile = tempPath('.hwp')
      const hwpxFile = hwpFile.replace(/\.hwp$/, '.hwpx')
      tempFiles.push(hwpxFile)
      await generateReadmeHwp(hwpFile)

      const result = await runCli(['convert', hwpFile, hwpxFile])
      expect(result.exitCode).toBe(0)
    })

    it('HWPX section0.xml contains all paragraph texts', async () => {
      const hwpFile = tempPath('.hwp')
      const hwpxFile = hwpFile.replace(/\.hwp$/, '.hwpx')
      tempFiles.push(hwpxFile)
      await generateReadmeHwp(hwpFile)
      await runCli(['convert', hwpFile, hwpxFile])

      const data = await readFile(hwpxFile)
      const zip = await JSZip.loadAsync(data)
      const xml = await zip.file('Contents/section0.xml')!.async('string')

      expect(xml).toContain('hwpilot')
      expect(xml).toContain('배경')
      expect(xml).toContain('주요 기능')
      expect(xml).toContain('설치')
      expect(xml).toContain('라이선스')
      expect(xml).toContain('MIT')
      expect(xml).toContain('npm install -g hwpilot')
      expect(xml).toContain('AI 에이전트')
    })

    it('HWPX non-empty text matches HWP non-empty text', async () => {
      const hwpFile = tempPath('.hwp')
      const hwpxFile = hwpFile.replace(/\.hwp$/, '.hwpx')
      tempFiles.push(hwpxFile)
      await generateReadmeHwp(hwpFile)
      await runCli(['convert', hwpFile, hwpxFile])

      const hwpResult = await runCli(['text', hwpFile])
      const hwpxResult = await runCli(['text', hwpxFile])
      const hwpOutput = parseOutput(hwpResult) as any
      const hwpxOutput = parseOutput(hwpxResult) as any
      const normalize = (t: string) =>
        t
          .split('\n')
          .filter((l: string) => l.trim().length > 0)
          .join('\n')
      expect(normalize(hwpOutput.text)).toBe(normalize(hwpxOutput.text))
    })
  })

  describe('E. CHAR_SHAPE Record Ordering', () => {
    it('all CHAR_SHAPE records are contiguous in DocInfo stream', async () => {
      const file = tempPath('.hwp')
      await generateReadmeHwp(file)

      const CFB = (await import('cfb')).default
      const { decompressStream } = await import('../src/formats/hwp/stream-util')
      const { iterateRecords } = await import('../src/formats/hwp/record-parser')
      const { TAG } = await import('../src/formats/hwp/tag-ids')

      const buf = await readFile(file)
      const cfb = CFB.read(buf, { type: 'buffer' })

      const fh = CFB.find(cfb, '/FileHeader')
      const compressed = fh?.content ? (Buffer.from(fh.content).readUInt32LE(36) & 0x1) !== 0 : false

      const docInfoEntry = CFB.find(cfb, '/DocInfo')
      let stream = Buffer.from(docInfoEntry!.content!)
      if (compressed) stream = Buffer.from(decompressStream(stream))

      // given — collect tag sequence
      const tagSequence: number[] = []
      for (const { header } of iterateRecords(stream)) {
        tagSequence.push(header.tagId)
      }

      // when — find CHAR_SHAPE positions
      const charShapePositions = tagSequence.map((tag, i) => (tag === TAG.CHAR_SHAPE ? i : -1)).filter((i) => i >= 0)

      // then — all CHAR_SHAPE records should be contiguous (no gaps)
      expect(charShapePositions.length).toBeGreaterThan(0)
      for (let i = 1; i < charShapePositions.length; i++) {
        expect(charShapePositions[i]).toBe(charShapePositions[i - 1] + 1)
      }
    })
  })
})

describe.skipIf(!isViewerAvailable)('Z. Viewer Corruption Check', () => {
  it('formatted multi-paragraph HWP opens without corruption alert', async () => {
    const file = tempPath('.hwp')
    await generateReadmeHwp(file)

    const result = await checkViewerCorruption(file)
    expect(result.skipped).toBe(false)
    expect(result.corrupted).toBe(false)
    expect(result.alert).toBeUndefined()
  }, 15_000)
})
