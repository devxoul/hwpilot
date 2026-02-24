import { afterEach, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestHwpBinary } from '../../test-helpers'
import { loadHwp } from './reader'

const TMP_FILES: string[] = []

afterEach(async () => {
  await Promise.all(
    TMP_FILES.splice(0).map(async (filePath) => {
      await Bun.file(filePath).delete()
    }),
  )
})

describe('createTestHwpBinary', () => {
  it('round-trips FACE_NAME records with default font', async () => {
    const filePath = join(tmpdir(), `hwp-creator-${Date.now()}-${Math.random().toString(16).slice(2)}.hwp`)
    TMP_FILES.push(filePath)

    const fixture = await createTestHwpBinary({ paragraphs: ['Hello'] })
    await Bun.write(filePath, fixture)

    const doc = await loadHwp(filePath)
    expect(doc.header.fonts.length).toBeGreaterThanOrEqual(1)
    expect(doc.header.fonts[0]?.name).toBe('맑은 고딕')
  })
})
