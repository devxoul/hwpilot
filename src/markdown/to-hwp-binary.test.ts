import { afterEach, describe, expect, it } from 'bun:test'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadHwp } from '@/formats/hwp/reader'

import { markdownToHwpBinary } from './to-hwp-binary'

const tempFiles = new Set<string>()

afterEach(async () => {
  await Promise.all(
    [...tempFiles].map(async (filePath) => {
      tempFiles.delete(filePath)
      await unlink(filePath).catch(() => {})
    }),
  )
})

async function writeTempHwp(buffer: Buffer): Promise<string> {
  const path = join(tmpdir(), `markdown-to-hwp-binary-test-${Date.now()}-${Math.random().toString(16).slice(2)}.hwp`)
  tempFiles.add(path)
  await writeFile(path, buffer)
  return path
}

describe('markdownToHwpBinary', () => {
  it('returns Buffer', async () => {
    const buffer = await markdownToHwpBinary('Hello')

    expect(Buffer.isBuffer(buffer)).toBe(true)
  })

  it('returns HWP CFB magic bytes', async () => {
    const buffer = await markdownToHwpBinary('Hello')

    expect([...buffer.subarray(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0])
  })

  it('keeps plain text paragraph content', async () => {
    const buffer = await markdownToHwpBinary('Hello\n\nWorld')
    const path = await writeTempHwp(buffer)
    const doc = await loadHwp(path)
    const texts = doc.sections[0].paragraphs
      .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
      .filter((text) => text.length > 0)

    expect(texts).toEqual(['Hello', 'World'])
  })

  it('preserves heading level on heading paragraph', async () => {
    const buffer = await markdownToHwpBinary('# Title\n\nBody')
    const path = await writeTempHwp(buffer)
    const doc = await loadHwp(path)
    const headingPara = doc.sections[0].paragraphs.find(
      (paragraph) => paragraph.runs.map((run) => run.text).join('').length > 0,
    )

    expect(headingPara).toBeDefined()

    const paraShape = doc.header.paraShapes[headingPara.paraShapeRef]

    expect(paraShape.headingLevel).toBeGreaterThan(0)
  })

  it('converts markdown table into HWP table', async () => {
    const buffer = await markdownToHwpBinary('| A | B |\n|---|---|\n| 1 | 2 |')
    const path = await writeTempHwp(buffer)
    const doc = await loadHwp(path)

    expect(doc.sections[0].tables).toHaveLength(1)
  })

  it('skips images and still returns valid HWP buffer', async () => {
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '))
    }

    try {
      const buffer = await markdownToHwpBinary('![alt](./img.png)')
      const path = await writeTempHwp(buffer)
      const doc = await loadHwp(path)

      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(doc.format).toBe('hwp')
      expect(warnings.some((warning) => warning.includes('images are not supported in HWP binary output'))).toBe(true)
    } finally {
      console.warn = originalWarn
    }
  })

  it('flattens multi-section markdown into single HWP section', async () => {
    const buffer = await markdownToHwpBinary('Section 1\n\n---\n\nSection 2')
    const path = await writeTempHwp(buffer)
    const doc = await loadHwp(path)
    const texts = doc.sections[0].paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))

    expect(doc.sections).toHaveLength(1)
    expect(texts).toContain('Section 1')
    expect(texts).toContain('Section 2')
  })
})
