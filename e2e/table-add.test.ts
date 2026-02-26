import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { cleanupFiles, crossValidate, FIXTURES, parseOutput, runCli, tempCopy, validateFile } from './helpers'

const FIXTURE = FIXTURES.wageClaim
const tempFiles: string[] = []

function tempPath(suffix: string, ext = '.hwp'): string {
  const p = join(tmpdir(), `e2e-table-add-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  tempFiles.push(p)
  return p
}

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Table Add — HWP fixture', () => {
  describe('A. Basic Table Add', () => {
    it('adds a table and table count increases by 1', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — count existing tables
      const beforeResult = await runCli(['table', 'list', temp])
      const beforeTables = parseOutput(beforeResult) as any[]
      const beforeCount = beforeTables.length

      // when — add a 2x3 table
      const addResult = await runCli(['table', 'add', temp, '2', '3'])
      const addOutput = parseOutput(addResult) as any
      expect(addOutput.success).toBe(true)
      expect(addOutput.rows).toBe(2)
      expect(addOutput.cols).toBe(3)

      // then — table count increased
      const afterResult = await runCli(['table', 'list', temp])
      const afterTables = parseOutput(afterResult) as any[]
      expect(afterTables.length).toBe(beforeCount + 1)

      await validateFile(temp)
    })

    it('new table ref follows existing table indexing', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given
      const beforeResult = await runCli(['table', 'list', temp])
      const beforeTables = parseOutput(beforeResult) as any[]
      const expectedRef = `s0.t${beforeTables.length}`

      // when
      const addResult = await runCli(['table', 'add', temp, '1', '2'])
      const addOutput = parseOutput(addResult) as any

      // then
      expect(addOutput.ref).toBe(expectedRef)
    })
  })

  describe('B. Table Add with Data', () => {
    it('adds a table with data and reads back correct cell text', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      const data = [
        ['이름', '직급', '부서'],
        ['김철수', '과장', '개발팀'],
      ]

      // when — add with data
      const addResult = await runCli(['table', 'add', temp, '2', '3', '--data', JSON.stringify(data)])
      const addOutput = parseOutput(addResult) as any
      expect(addOutput.success).toBe(true)
      const newRef = addOutput.ref

      // then — read back the new table and verify cell text
      const readResult = await runCli(['table', 'read', temp, newRef])
      const table = parseOutput(readResult) as any
      expect(table.rows).toHaveLength(2)
      expect(table.rows[0].cells[0].text).toBe('이름')
      expect(table.rows[0].cells[1].text).toBe('직급')
      expect(table.rows[0].cells[2].text).toBe('부서')
      expect(table.rows[1].cells[0].text).toBe('김철수')
      expect(table.rows[1].cells[1].text).toBe('과장')
      expect(table.rows[1].cells[2].text).toBe('개발팀')

      await validateFile(temp)
    })

    it('adds an empty table (no data) and reads back empty cells', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      const addResult = await runCli(['table', 'add', temp, '2', '2'])
      const addOutput = parseOutput(addResult) as any
      const newRef = addOutput.ref

      const readResult = await runCli(['table', 'read', temp, newRef])
      const table = parseOutput(readResult) as any
      expect(table.rows).toHaveLength(2)
      for (const row of table.rows) {
        expect(row.cells).toHaveLength(2)
        for (const cell of row.cells) {
          expect(cell.text).toBe('')
        }
      }
    })
  })

  describe('C. Existing Content Preservation', () => {
    it('adding a table does not corrupt existing paragraphs', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — capture original text
      const beforeText = await runCli(['text', FIXTURE])
      parseOutput(beforeText) // ensure it parses without error

      // when
      await runCli(['table', 'add', temp, '2', '2', '--data', '[["X","Y"],["1","2"]]'])

      // then — original text still present
      const afterText = await runCli(['text', temp])
      const afterOutput = parseOutput(afterText) as any
      expect(afterOutput.text).toContain('임금 등 청구의 소')
      expect(afterOutput.text).toContain('청   구   취   지')
      // new table data also present
      expect(afterOutput.text).toContain('X')
      expect(afterOutput.text).toContain('Y')
    })

    it('adding a table does not affect existing table cells', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      // given — read existing table
      const beforeResult = await runCli(['table', 'read', FIXTURE, 's0.t0'])
      const beforeTable = parseOutput(beforeResult) as any
      const originalCell = beforeTable.rows[0].cells[0].text

      // when
      await runCli(['table', 'add', temp, '1', '1', '--data', '[["NEW"]]'])

      // then — existing table unchanged
      const afterResult = await runCli(['table', 'read', temp, 's0.t0'])
      const afterTable = parseOutput(afterResult) as any
      expect(afterTable.rows[0].cells[0].text).toBe(originalCell)
    })
  })

  describe('D. Cross-Validation', () => {
    it('added table data survives HWP→HWPX conversion', async () => {
      const temp = await tempCopy(FIXTURE)
      tempFiles.push(temp)

      const marker = 'TABLE_ADD_CV_2026'
      await runCli(['table', 'add', temp, '1', '2', '--data', JSON.stringify([[marker, 'test']])])

      await validateFile(temp)
      const found = await crossValidate(temp, marker)
      expect(found).toBe(true)
    })
  })
})

describe('Table Add — HWPX (created document)', () => {
  it('adds a table to a blank HWPX and reads it back', async () => {
    const hwpxFile = tempPath('hwpx-blank', '.hwpx')

    // given — create a blank HWPX
    const createResult = await runCli(['create', hwpxFile])
    expect((parseOutput(createResult) as any).success).toBe(true)

    // when — add a table
    const addResult = await runCli(['table', 'add', hwpxFile, '2', '3', '--data', '[["A","B","C"],["D","E","F"]]'])
    const addOutput = parseOutput(addResult) as any
    expect(addOutput.success).toBe(true)
    expect(addOutput.ref).toBe('s0.t0')

    // then — read back
    const readResult = await runCli(['table', 'read', hwpxFile, 's0.t0'])
    const table = parseOutput(readResult) as any
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0].cells[0].text).toBe('A')
    expect(table.rows[1].cells[2].text).toBe('F')
  })

  it('added table is present in raw HWPX XML', async () => {
    const hwpxFile = tempPath('hwpx-xml', '.hwpx')
    await runCli(['create', hwpxFile])

    const marker = 'HWPX_TABLE_ADD_2026'
    await runCli(['table', 'add', hwpxFile, '1', '1', '--data', JSON.stringify([[marker]])])

    // directly inspect the HWPX zip XML
    const data = await readFile(hwpxFile)
    const zip = await JSZip.loadAsync(data)
    const xml = await zip.file('Contents/section0.xml')?.async('string')
    expect(xml).toBeDefined()
    expect(xml).toContain(marker)
    expect(xml).toContain('hp:tbl')
  })
})

describe('Z. Validation', () => {
  it('HWP with added table passes validation', async () => {
    const temp = await tempCopy(FIXTURE)
    tempFiles.push(temp)
    await runCli(['table', 'add', temp, '2', '2', '--data', '[["v1","v2"],["v3","v4"]]'])
    await validateFile(temp)
  })
})
