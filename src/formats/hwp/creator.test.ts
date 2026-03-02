import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import CFB from 'cfb'
import JSZip from 'jszip'
import { convertCommand } from '../../commands/convert'
import { createTestHwpBinary } from '../../test-helpers'
import { createHwp } from './creator'
import { loadHwp } from './reader'
import { iterateRecords } from './record-parser'
import { decompressStream, getCompressionFlag } from './stream-util'
import { TAG } from './tag-ids'

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

  describe('heading styles', () => {
    it('preserves 8 template charShapes', async () => {
      const filePath = createTempFilePath()
      const fixture = await createHwp()
      await Bun.write(filePath, fixture)

      const doc = await loadHwp(filePath)
      expect(doc.header.charShapes).toHaveLength(8)
    })

    it('preserves 20 template paraShapes', async () => {
      const filePath = createTempFilePath()
      const fixture = await createHwp()
      await Bun.write(filePath, fixture)

      const doc = await loadHwp(filePath)
      expect(doc.header.paraShapes).toHaveLength(20)
    })

    it('preserves 21 template styles', async () => {
      const filePath = createTempFilePath()
      const fixture = await createHwp()
      await Bun.write(filePath, fixture)

      const doc = await loadHwp(filePath)
      expect(doc.header.styles).toHaveLength(21)

      for (let i = 1; i <= 7; i++) {
        const style = doc.header.styles.find((item) => item.name === `개요 ${i}`)
        expect(style?.name).toBe(`개요 ${i}`)
      }
    })

    it('writes full PARA_SHAPE/STYLE payloads and section dloc control', async () => {
      const fixture = await createHwp({ compressed: true })
      const cfb = CFB.read(fixture, { type: 'buffer' })

      const fileHeader = CFB.find(cfb, '/FileHeader')
      expect(fileHeader?.content).toBeDefined()
      const fileHeaderBuffer = Buffer.from(fileHeader!.content as Uint8Array)
      expect(fileHeaderBuffer.readUInt32LE(32)).toBe(0x05010100)
      expect(fileHeaderBuffer[32]).toBe(0x00)
      expect(fileHeaderBuffer[33]).toBe(0x01)

      const compressed = getCompressionFlag(fileHeaderBuffer)
      const docInfoEntry = CFB.find(cfb, '/DocInfo')
      expect(docInfoEntry?.content).toBeDefined()
      let docInfo = Buffer.from(docInfoEntry!.content as Uint8Array)
      if (compressed) {
        docInfo = Buffer.from(decompressStream(docInfo))
      }

      const paraShapeSizes: number[] = []
      const styleTrailingSizes: number[] = []
      for (const { header, data } of iterateRecords(docInfo)) {
        if (header.tagId === TAG.PARA_SHAPE) {
          paraShapeSizes.push(data.length)
        }
        if (header.tagId === TAG.STYLE) {
          const nameLen = data.readUInt16LE(0)
          let offset = 2 + nameLen * 2
          const englishNameLen = data.readUInt16LE(offset)
          offset += 2 + englishNameLen * 2
          styleTrailingSizes.push(data.length - offset)
        }
      }

      expect(paraShapeSizes.length).toBeGreaterThanOrEqual(20)
      expect(paraShapeSizes[0]).toBe(58)
      for (const size of paraShapeSizes.slice(1, 20)) {
        expect(size).toBe(58)
      }

      expect(styleTrailingSizes.length).toBeGreaterThanOrEqual(21)
      for (const size of styleTrailingSizes.slice(1, 21)) {
        expect(size).toBeGreaterThanOrEqual(10)
      }

      const section0Entry = CFB.find(cfb, '/BodyText/Section0')
      expect(section0Entry?.content).toBeDefined()
      let section0 = Buffer.from(section0Entry!.content as Uint8Array)
      if (compressed) {
        section0 = Buffer.from(decompressStream(section0))
      }

      const sectionRecords = [...iterateRecords(section0)]
      const paraText = sectionRecords.find(({ header }) => header.tagId === TAG.PARA_TEXT && header.level === 1)
      expect(paraText).toBeDefined()
      expect(paraText!.data.includes(Buffer.from('dloc', 'ascii'))).toBe(true)

      const lineSeg = sectionRecords.find(({ header }) => header.tagId === TAG.PARA_LINE_SEG && header.level === 1)
      expect(lineSeg).toBeUndefined()

      const paraCharShape = sectionRecords.find(
        ({ header }) => header.tagId === TAG.PARA_CHAR_SHAPE && header.level === 1,
      )
      expect(paraCharShape).toBeDefined()
      const charShapeRef = paraCharShape!.data.readUInt32LE(4)
      expect(charShapeRef).toBeGreaterThanOrEqual(0)
      expect(charShapeRef).toBeLessThan(8)

      const dlocCtrlHeader = [...iterateRecords(section0)].find(
        ({ header, data }) =>
          header.tagId === TAG.CTRL_HEADER && header.level === 1 && data.subarray(0, 4).toString('ascii') === 'dloc',
      )
      expect(dlocCtrlHeader).toBeDefined()
      expect(dlocCtrlHeader!.data.length).toBe(16)
      expect(dlocCtrlHeader!.data.readUInt32LE(4)).toBe(0x00001004)
    })
  })
})
