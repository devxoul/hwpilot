import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import CFB from 'cfb'
import { createTestHwpBinary } from '../../test-helpers'
import { loadHwp } from './reader'
import { iterateRecords } from './record-parser'
import { getCompressionFlag } from './stream-util'
import { TAG } from './tag-ids'
import { editHwp } from './writer'

const TMP_FILES: string[] = []

afterEach(async () => {
  await Promise.all(
    TMP_FILES.splice(0).map(async (filePath) => {
      await Bun.file(filePath).delete()
    }),
  )
})

describe('editHwp', () => {
  it('setText on first paragraph changes target and keeps second paragraph', async () => {
    const filePath = tmpPath('writer-set-text')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['first', 'second'] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setText', ref: 's0.p0', text: 'changed' }])

    const doc = await loadHwp(filePath)
    expect(joinRuns(doc.sections[0].paragraphs[0].runs)).toBe('changed')
    expect(joinRuns(doc.sections[0].paragraphs[1].runs)).toBe('second')
  })

  it('setText supports Korean UTF-16LE content', async () => {
    const filePath = tmpPath('writer-korean')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['기존 텍스트'] })
    await Bun.write(filePath, fixture)

    await editHwp(filePath, [{ type: 'setText', ref: 's0.p0', text: '안녕하세요 한글' }])

    const doc = await loadHwp(filePath)
    expect(joinRuns(doc.sections[0].paragraphs[0].runs)).toBe('안녕하세요 한글')
  })

  it('setText supports longer text than original record size', async () => {
    const filePath = tmpPath('writer-longer')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['a'] })
    await Bun.write(filePath, fixture)

    const nextText = 'this is a much longer replacement paragraph text'
    await editHwp(filePath, [{ type: 'setText', ref: 's0.p0', text: nextText }])

    const doc = await loadHwp(filePath)
    expect(joinRuns(doc.sections[0].paragraphs[0].runs)).toBe(nextText)
  })

  it('setText on compressed file preserves compression flag', async () => {
    const filePath = tmpPath('writer-compressed')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['before'], compressed: true })
    await Bun.write(filePath, fixture)

    const beforeHeader = await getFileHeader(filePath)
    expect(getCompressionFlag(beforeHeader)).toBe(true)

    await editHwp(filePath, [{ type: 'setText', ref: 's0.p0', text: 'after' }])

    const afterHeader = await getFileHeader(filePath)
    expect(getCompressionFlag(afterHeader)).toBe(true)

    const doc = await loadHwp(filePath)
    expect(joinRuns(doc.sections[0].paragraphs[0].runs)).toBe('after')
  })

  it('setText keeps untouched paragraph PARA_TEXT records byte-identical', async () => {
    const filePath = tmpPath('writer-byte-identical')
    TMP_FILES.push(filePath)
    const fixture = await createTestHwpBinary({ paragraphs: ['one', 'two', 'three'] })
    await Bun.write(filePath, fixture)

    const beforeSection = await getSectionBuffer(filePath, 0)
    const beforeParaTextRecords = collectTopLevelParaTextRecords(beforeSection)

    await editHwp(filePath, [{ type: 'setText', ref: 's0.p1', text: 'middle changed and longer' }])

    const afterSection = await getSectionBuffer(filePath, 0)
    const afterParaTextRecords = collectTopLevelParaTextRecords(afterSection)

    expect(afterParaTextRecords).toHaveLength(3)
    expect(Buffer.compare(beforeParaTextRecords[0], afterParaTextRecords[0])).toBe(0)
    expect(Buffer.compare(beforeParaTextRecords[2], afterParaTextRecords[2])).toBe(0)
  })
})

function tmpPath(name: string): string {
  return `/tmp/${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.hwp`
}

function joinRuns(runs: Array<{ text: string }>): string {
  return runs.map((run) => run.text).join('')
}

async function getFileHeader(filePath: string): Promise<Buffer> {
  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const entry = CFB.find(cfb, '/FileHeader')
  if (!entry?.content) {
    throw new Error('FileHeader not found')
  }
  return Buffer.from(entry.content)
}

async function getSectionBuffer(filePath: string, section: number): Promise<Buffer> {
  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const entry = CFB.find(cfb, `/BodyText/Section${section}`)
  if (!entry?.content) {
    throw new Error(`Section stream not found: ${section}`)
  }
  return Buffer.from(entry.content)
}

function collectTopLevelParaTextRecords(stream: Buffer): Buffer[] {
  const records: Buffer[] = []
  let paragraphIndex = -1

  for (const { header, offset } of iterateRecords(stream)) {
    if (header.tagId === TAG.PARA_HEADER && header.level === 0) {
      paragraphIndex += 1
      continue
    }

    if (header.tagId === TAG.PARA_TEXT && header.level === 1 && paragraphIndex >= 0) {
      records[paragraphIndex] = Buffer.from(stream.subarray(offset, offset + header.headerSize + header.size))
    }
  }

  return records
}
