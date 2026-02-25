import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { convertCommand } from '../../commands/convert'
import { createTestHwpBinary } from '../../test-helpers'
import { createHwp } from './creator'
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

describe('createHwp', () => {
  function createTempFilePath(): string {
    const filePath = join(tmpdir(), `hwp-creator-${Date.now()}-${Math.random().toString(16).slice(2)}.hwp`)
    TMP_FILES.push(filePath)
    return filePath
  }

  it('returns valid CFB buffer when called without options', async () => {
    const buffer = await createHwp()
    expect(buffer.subarray(0, 4).toString('hex')).toBe('d0cf11e0')
  })

  it('creates a blank document with one empty paragraph', async () => {
    const filePath = createTempFilePath()

    const fixture = await createHwp()
    await Bun.write(filePath, fixture)

    const doc = await loadHwp(filePath)
    expect(doc.sections[0]?.paragraphs).toHaveLength(1)
  })

  it('writes configured font name into document header', async () => {
    const filePath = createTempFilePath()

    const fixture = await createHwp({ font: '바탕' })
    await Bun.write(filePath, fixture)

    const doc = await loadHwp(filePath)
    expect(doc.header.fonts[0]?.name).toBe('바탕')
  })

  it('writes font size in hundredths of points', async () => {
    const filePath = createTempFilePath()

    const fixture = await createHwp({ fontSize: 1200 })
    await Bun.write(filePath, fixture)

    const doc = await loadHwp(filePath)
    expect(doc.header.charShapes[0]?.fontSize).toBe(12)
  })

  it('creates compressed stream data by default and reads successfully', async () => {
    const filePath = createTempFilePath()

    const fixture = await createHwp({ compressed: true })
    await Bun.write(filePath, fixture)

    const doc = await loadHwp(filePath)
    expect(doc.sections.length).toBeGreaterThanOrEqual(1)
  })

  describe('cross-validation', () => {
    it('created HWP survives HWP→HWPX cross-validation', async () => {
      const hwpPath = createTempFilePath()
      const hwpxPath = join(tmpdir(), `hwp-creator-${Date.now()}-${Math.random().toString(16).slice(2)}.hwpx`)
      TMP_FILES.push(hwpxPath)

      const fixture = await createHwp({
        font: '바탕',
        fontSize: 1200,
      })
      await Bun.write(hwpPath, fixture)

      await convertCommand(hwpPath, hwpxPath, { force: true })

      const data = await readFile(hwpxPath)
      const zip = await JSZip.loadAsync(data)

      const sectionXml = zip.file('Contents/section0.xml')
      expect(sectionXml).toBeDefined()

      const headerXml = zip.file('Contents/header.xml')
      expect(headerXml).toBeDefined()
      const headerContent = await headerXml!.async('string')
      expect(headerContent).toContain('바탕')
    })
  })
})
