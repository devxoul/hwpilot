import { afterEach, describe, expect, it } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestHwpBinary, createTestHwpx } from '../src/test-helpers'
import { cleanupFiles, parseOutput, runCli } from './helpers'

const tempFiles: string[] = []

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

async function createSyntheticFixture(format: 'hwpx' | 'hwp', text = 'test content'): Promise<string> {
  const filePath = join(tmpdir(), `e2e-textbox-${Date.now()}-${Math.random().toString(36).slice(2)}.${format}`)
  const buffer =
    format === 'hwpx'
      ? await createTestHwpx({ textBoxes: [{ text }] })
      : await createTestHwpBinary({ textBoxes: [{ text }] })
  writeFileSync(filePath, buffer)
  tempFiles.push(filePath)
  return filePath
}

describe('Text Box Support (synthetic fixtures)', () => {
  describe('A. HWPX text box E2E', () => {
    it('read includes textBoxes with expected refs', async () => {
      const temp = await createSyntheticFixture('hwpx')

      const result = await runCli(['read', temp])
      const doc = parseOutput(result) as any

      expect(doc.sections[0].textBoxes).toBeDefined()
      expect(doc.sections[0].textBoxes).toHaveLength(1)
      expect(doc.sections[0].textBoxes[0].ref).toBe('s0.tb0')
      expect(doc.sections[0].textBoxes[0].paragraphs[0].ref).toBe('s0.tb0.p0')
    })

    it('text extracts text box paragraph content', async () => {
      const temp = await createSyntheticFixture('hwpx')

      const result = await runCli(['text', temp, 's0.tb0.p0'])
      const output = parseOutput(result) as any

      expect(output.ref).toBe('s0.tb0.p0')
      expect(output.text).toBe('test content')
    })

    it('find returns a match for text in text box', async () => {
      const temp = await createSyntheticFixture('hwpx')

      const result = await runCli(['find', temp, 'test content', '--json'])
      const output = parseOutput(result) as any

      expect(output.matches).toHaveLength(1)
      expect(output.matches[0].ref).toBe('s0.tb0.p0')
      expect(output.matches[0].text).toBe('test content')
      expect(output.matches[0].container).toBe('textBox')
    })

    it('edit updates text box text and re-read shows new value', async () => {
      const temp = await createSyntheticFixture('hwpx')

      const editResult = await runCli(['edit', 'text', temp, 's0.tb0.p0', 'new content'])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s0.tb0.p0')

      const textResult = await runCli(['text', temp, 's0.tb0.p0'])
      const textOutput = parseOutput(textResult) as any
      expect(textOutput.text).toBe('new content')
    })
  })

  describe('B. HWP text box E2E', () => {
    it('read includes textBoxes with expected refs', async () => {
      const temp = await createSyntheticFixture('hwp')

      const result = await runCli(['read', temp])
      const doc = parseOutput(result) as any

      expect(doc.format).toBe('hwp')
      expect(doc.sections[0].textBoxes).toBeDefined()
      expect(doc.sections[0].textBoxes).toHaveLength(1)
      expect(doc.sections[0].textBoxes[0].ref).toBe('s0.tb0')
      expect(doc.sections[0].textBoxes[0].paragraphs[0].ref).toBe('s0.tb0.p0')
    })

    it('text extracts text box paragraph content', async () => {
      const temp = await createSyntheticFixture('hwp')

      const result = await runCli(['text', temp, 's0.tb0.p0'])
      const output = parseOutput(result) as any

      expect(output.ref).toBe('s0.tb0.p0')
      expect(output.text).toBe('test content')
    })

    it('find returns a match for text in text box', async () => {
      const temp = await createSyntheticFixture('hwp')

      const result = await runCli(['find', temp, 'test content', '--json'])
      const output = parseOutput(result) as any

      expect(output.matches).toHaveLength(1)
      expect(output.matches[0].ref).toBe('s0.tb0.p0')
      expect(output.matches[0].text).toBe('test content')
      expect(output.matches[0].container).toBe('textBox')
    })

    it('edit updates text box text and re-read shows new value', async () => {
      const temp = await createSyntheticFixture('hwp')

      const editResult = await runCli(['edit', 'text', temp, 's0.tb0.p0', 'new content'])
      const editOutput = parseOutput(editResult) as any
      expect(editOutput.success).toBe(true)
      expect(editOutput.ref).toBe('s0.tb0.p0')

      const textResult = await runCli(['text', temp, 's0.tb0.p0'])
      const textOutput = parseOutput(textResult) as any
      expect(textOutput.text).toBe('new content')

      const readResult = await runCli(['read', temp])
      const readOutput = parseOutput(readResult) as any
      const runText = readOutput.sections[0].textBoxes[0].paragraphs[0].runs[0].text
      expect(runText).toBe('new content')
    })
  })
})
