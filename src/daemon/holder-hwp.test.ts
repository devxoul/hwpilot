import { describe, expect, it } from 'bun:test'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadHwp } from '../formats/hwp/reader'
import { createTestHwpBinary } from '../test-helpers'
import { HwpHolder } from './holder-hwp'

async function createTempHwp(paragraphs: string[]): Promise<{ dirPath: string; filePath: string }> {
  const dirPath = await mkdtemp(join(tmpdir(), 'holder-hwp-'))
  const filePath = join(dirPath, 'fixture.hwp')
  const buffer = await createTestHwpBinary({ paragraphs })
  await writeFile(filePath, buffer)
  return { dirPath, filePath }
}

function getParagraphText(text: string): [{ type: 'setText'; ref: string; text: string }] {
  return [{ type: 'setText', ref: 's0.p0', text }]
}

describe('HwpHolder', () => {
  it('loads, reads via cache, mutates, and serves updated sections', async () => {
    const { dirPath, filePath } = await createTempHwp(['Before'])

    try {
      const holder = new HwpHolder(filePath)
      await holder.load()

      const firstSections = await holder.getSections()
      const secondSections = await holder.getSections()

      expect(firstSections).toBe(secondSections)
      expect(firstSections[0].paragraphs[0].runs[0].text).toBe('Before')

      await holder.applyOperations(getParagraphText('After'))

      const thirdSections = await holder.getSections()
      expect(thirdSections).not.toBe(firstSections)
      expect(thirdSections[0].paragraphs[0].runs[0].text).toBe('After')
    } finally {
      await rm(dirPath, { recursive: true, force: true })
    }
  })

  it('flush writes to disk and persisted content is readable with loadHwp', async () => {
    const { dirPath, filePath } = await createTempHwp(['Disk Before'])

    try {
      const holder = new HwpHolder(filePath)
      await holder.load()
      await holder.applyOperations(getParagraphText('Disk After'))
      await holder.flush()

      const doc = await loadHwp(filePath)
      expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('Disk After')

      const tmpPath = `${filePath}.tmp`
      await expect(access(tmpPath)).rejects.toThrow()
    } finally {
      await rm(dirPath, { recursive: true, force: true })
    }
  })

  it('tracks dirty state across load, mutation, and flush', async () => {
    const { dirPath, filePath } = await createTempHwp(['Dirty Before'])

    try {
      const holder = new HwpHolder(filePath)
      await holder.load()
      expect(holder.isDirty()).toBe(false)

      await holder.applyOperations(getParagraphText('Dirty After'))
      expect(holder.isDirty()).toBe(true)

      await holder.flush()
      expect(holder.isDirty()).toBe(false)
    } finally {
      await rm(dirPath, { recursive: true, force: true })
    }
  })
})
