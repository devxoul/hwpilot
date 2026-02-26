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

const FIXTURE = FIXTURES.employmentContract
const tempFiles: string[] = []

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Table Cell Edit (표 셀 편집)', () => {
  describe('A. Table Structure Baseline', () => {
    it('lists tables with correct row/col counts', async () => {
      const result = await runCli(['table', 'list', FIXTURE])
      const tables = parseOutput(result) as any[]
      expect(tables.length).toBeGreaterThanOrEqual(7)

      // s0.t6 is a 5x7 schedule table
      const t6 = tables.find((t: any) => t.ref === 's0.t6')
      expect(t6).toBeDefined()
      expect(t6.rows).toBe(5)
      expect(t6.cols).toBe(7)
    })

    it('reads specific cell text from s0.t6', async () => {
      const result = await runCli(['table', 'read', FIXTURE, 's0.t6'])
      const table = parseOutput(result) as any
      // r0.c1 contains "(    )요일"
      const cell = table.rows[0].cells[1]
      expect(cell.ref).toBe('s0.t6.r0.c1')
      expect(cell.text).toContain('요일')
    })
  })

  describe('B. Single Cell Edit', () => {
    it('edits a table cell and reads back correct value', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — read original cell value
      const beforeResult = await runCli(['table', 'read', FIXTURE, 's0.t6'])
      const beforeTable = parseOutput(beforeResult) as any
      const originalText = beforeTable.rows[0].cells[1].text
      expect(originalText).toContain('요일')

      // when — edit cell s0.t6.r0.c1
      const newText = '월요일'
      const editResult = await runCli(['table', 'edit', temp, 's0.t6.r0.c1', newText])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)

      // then — read back and verify
      const afterResult = await runCli(['table', 'read', temp, 's0.t6'])
      const afterTable = parseOutput(afterResult) as any
      expect(afterTable.rows[0].cells[1].text).toBe(newText)

      await validateFile(temp)
    })

    it('editing one cell does not change adjacent cells', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — capture original values of adjacent cells
      const beforeResult = await runCli(['table', 'read', FIXTURE, 's0.t6'])
      const beforeTable = parseOutput(beforeResult) as any
      const originalC0 = beforeTable.rows[0].cells[0].text
      const originalC2 = beforeTable.rows[0].cells[2].text

      // when — edit only c1
      const editResult = await runCli(['table', 'edit', temp, 's0.t6.r0.c1', '테스트'])
      expect((parseOutput(editResult) as any).success).toBe(true)

      // then — adjacent cells unchanged
      const afterResult = await runCli(['table', 'read', temp, 's0.t6'])
      const afterTable = parseOutput(afterResult) as any
      expect(afterTable.rows[0].cells[0].text).toBe(originalC0)
      expect(afterTable.rows[0].cells[2].text).toBe(originalC2)
      expect(afterTable.rows[0].cells[1].text).toBe('테스트')
    })
  })

  describe('C. Multi-Row Cell Edit', () => {
    it('edits cells in different rows independently', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — read original row 1 and row 2 values
      const beforeResult = await runCli(['table', 'read', FIXTURE, 's0.t8'])
      const beforeTable = parseOutput(beforeResult) as any
      const _originalR0C1 = beforeTable.rows[0].cells[1].text
      const originalR1C1 = beforeTable.rows[1].cells[1]?.text

      // when — edit row 0, cell 1
      const editResult = await runCli(['table', 'edit', temp, 's0.t8.r0.c1', '수정됨'])
      expect((parseOutput(editResult) as any).success).toBe(true)

      // then — edited cell changed, other row's same column unchanged
      const afterResult = await runCli(['table', 'read', temp, 's0.t8'])
      const afterTable = parseOutput(afterResult) as any
      expect(afterTable.rows[0].cells[1].text).toBe('수정됨')
      if (originalR1C1 !== undefined) {
        expect(afterTable.rows[1].cells[1].text).toBe(originalR1C1)
      }
    })
  })

  describe('D. Cross-Validation', () => {
    it('edited table cell text survives HWP→HWPX conversion', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      const marker = 'TABLE_EDIT_CV_2026'
      const editResult = await runCli(['table', 'edit', temp, 's0.t6.r0.c1', marker])
      expect((parseOutput(editResult) as any).success).toBe(true)

      // cross-validate: convert to HWPX and check raw XML
      await validateFile(temp)
      const found = await crossValidate(temp, marker)
      expect(found).toBe(true)
    })
  })

  describe('E. Korean Content', () => {
    it('handles Korean text in table cells correctly', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      const koreanText = '서울특별시 강남구 역삼동 123-45'
      const editResult = await runCli(['table', 'edit', temp, 's0.t6.r0.c1', koreanText])
      expect((parseOutput(editResult) as any).success).toBe(true)

      const afterResult = await runCli(['table', 'read', temp, 's0.t6'])
      const afterTable = parseOutput(afterResult) as any
      expect(afterTable.rows[0].cells[1].text).toBe(koreanText)

      await validateFile(temp)
    })
  })
})

describe.skipIf(!isViewerAvailable)('Z. Viewer Corruption Check', () => {
  it('edited file passes HWP Viewer corruption check', async () => {
    const temp = await tempCopy(FIXTURE)
    tempFiles.push(temp)
    await runCli(['table', 'edit', temp, 's0.t6.r0.c1', 'viewer-corruption-test'])
    const result = await checkViewerCorruption(temp)
    expect(result.corrupted).toBe(false)
    expect(result.skipped).toBe(false)
  }, 15_000)
})
