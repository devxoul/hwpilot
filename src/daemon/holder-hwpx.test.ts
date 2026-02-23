import { describe, expect, it } from 'bun:test'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadHwpx } from '../formats/hwpx/loader'
import { parseSections } from '../formats/hwpx/section-parser'
import { createTestHwpx } from '../test-helpers'
import { HwpxHolder } from './holder-hwpx'

async function createTempHwpx(paragraphs: string[]): Promise<{ dirPath: string; filePath: string }> {
  const dirPath = await mkdtemp(join(tmpdir(), 'holder-hwpx-'))
  const filePath = join(dirPath, 'fixture.hwpx')
  const buffer = await createTestHwpx({ paragraphs })
  await writeFile(filePath, buffer)
  return { dirPath, filePath }
}

function getParagraphText(text: string): [{ type: 'setText'; ref: string; text: string }] {
  return [{ type: 'setText', ref: 's0.p0', text }]
}

describe('HwpxHolder', () => {
  it('loads, reads via cache, mutates, and serves updated sections', async () => {
    const { dirPath, filePath } = await createTempHwpx(['Before'])

    try {
      const holder = new HwpxHolder(filePath)
      await holder.load()

      const firstSections = await holder.getSections()
      const secondSections = await holder.getSections()

      expect(firstSections).toBe(secondSections)
      expect(firstSections[0].paragraphs[0].runs[0].text).toBe('Before')

      await holder.applyOperations(getParagraphText('After'))

      expect(holder.isDirty()).toBe(true)

      const thirdSections = await holder.getSections()
      expect(thirdSections).not.toBe(firstSections)
      expect(thirdSections[0].paragraphs[0].runs[0].text).toBe('After')
    } finally {
      await rm(dirPath, { recursive: true, force: true })
    }
  })

  it('flushes to disk atomically and removes temp file', async () => {
    const { dirPath, filePath } = await createTempHwpx(['Disk Before'])

    try {
      const holder = new HwpxHolder(filePath)
      await holder.load()
      await holder.applyOperations(getParagraphText('Disk After'))

      await holder.flush()

      expect(holder.isDirty()).toBe(false)

      const archive = await loadHwpx(filePath)
      const sections = await parseSections(archive)
      expect(sections[0].paragraphs[0].runs[0].text).toBe('Disk After')

      const tmpPath = `${filePath}.tmp`
      await expect(access(tmpPath)).rejects.toThrow()
    } finally {
      await rm(dirPath, { recursive: true, force: true })
    }
  })
})
