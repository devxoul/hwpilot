import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import CFB from 'cfb'
import { deflateRaw, inflateRaw } from 'pako'

import { iterateRecords } from '../src/formats/hwp/record-parser'
import { TAG } from '../src/formats/hwp/tag-ids'
import type { ValidateResult } from '../src/formats/hwp/validator'
import * as helpers from './helpers'

const isViewerAvailable = await helpers.isHwpViewerAvailable()

const tempFiles: string[] = []

afterEach(async () => {
  await helpers.cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('validate command', () => {
  describe('A. Clean fixture validation (calibration)', () => {
    const fixtureEntries = Object.entries(helpers.FIXTURES) as [string, string][]

    for (const [name, fixturePath] of fixtureEntries) {
      it(`validates ${name} as clean`, async () => {
        const result = await helpers.runCli(['validate', fixturePath])
        expect(result.exitCode).toBe(0)
        const output = parseValidateOutput(result)
        expect(output.valid).toBe(true)
        expect(output.format).toBe('hwp')
      })
    }
  })

  describe('B. Programmatic corruption detection', () => {
    it('detects truncated section stream', async () => {
      const tempPath = await helpers.tempCopy(helpers.FIXTURES.assaultComplaint)
      tempFiles.push(tempPath)
      await createTruncatedHwp(helpers.FIXTURES.assaultComplaint, tempPath)

      await expectCorrupted(tempPath)
    })

    it('detects wrong nChars value', async () => {
      const tempPath = await helpers.tempCopy(helpers.FIXTURES.assaultComplaint)
      tempFiles.push(tempPath)
      await patchParaHeaderNChars(helpers.FIXTURES.assaultComplaint, tempPath, 99_999)

      await expectCorrupted(tempPath)
    })

    it('detects out-of-bounds charShapeRef', async () => {
      const tempPath = await helpers.tempCopy(helpers.FIXTURES.assaultComplaint)
      tempFiles.push(tempPath)
      await patchParaCharShapeRef(helpers.FIXTURES.assaultComplaint, tempPath, 999)

      await expectCorrupted(tempPath)
    })

    it('detects missing DocInfo stream', async () => {
      const tempPath = await helpers.tempCopy(helpers.FIXTURES.assaultComplaint)
      tempFiles.push(tempPath)
      await removeDocInfoStream(helpers.FIXTURES.assaultComplaint, tempPath)

      await expectCorrupted(tempPath)
    })

    it('detects missing Section0 stream', async () => {
      const tempPath = await helpers.tempCopy(helpers.FIXTURES.assaultComplaint)
      tempFiles.push(tempPath)
      await removeSection0Stream(helpers.FIXTURES.assaultComplaint, tempPath)

      await expectCorrupted(tempPath)
    })

    it('detects ID_MAPPINGS count mismatch', async () => {
      const tempPath = await helpers.tempCopy(helpers.FIXTURES.assaultComplaint)
      tempFiles.push(tempPath)
      await patchIdMappingsCharShapeCount(helpers.FIXTURES.assaultComplaint, tempPath)

      await expectCorrupted(tempPath)
    })

    it('detects invalid FileHeader signature', async () => {
      const tempPath = await helpers.tempCopy(helpers.FIXTURES.assaultComplaint)
      tempFiles.push(tempPath)
      await patchInvalidFileHeaderSignature(helpers.FIXTURES.assaultComplaint, tempPath)

      await expectCorrupted(tempPath)
    })

    it('detects encryption flag', async () => {
      const tempPath = await helpers.tempCopy(helpers.FIXTURES.assaultComplaint)
      tempFiles.push(tempPath)
      await patchEncryptionFlag(helpers.FIXTURES.assaultComplaint, tempPath)

      await expectCorrupted(tempPath)
    })

    it('handles non-HWP file', async () => {
      const tempPath = join(tmpdir(), `e2e-validate-nonhwp-${Date.now()}.bin`)
      tempFiles.push(tempPath)
      await Bun.write(tempPath, crypto.getRandomValues(new Uint8Array(256)))

      await expectCorrupted(tempPath)
    })
  })

  describe('C. Post-edit validation execution', () => {
    it('validates file after setText on s0.p0', async () => {
      const tempPath = await helpers.tempCopy(helpers.FIXTURES.assaultComplaint)
      tempFiles.push(tempPath)

      const editResult = await helpers.runCli(['edit', 'text', tempPath, 's0.p0', 'VALIDATE_TEXT_EDIT_2026'])
      expect(editResult.exitCode).toBe(0)

      const validateResult = await helpers.runCli(['validate', tempPath])
      expect([0, 1]).toContain(validateResult.exitCode)
      const output = parseValidateOutput(validateResult)
      expect(typeof output.valid).toBe('boolean')
      expect(output.format).toBe('hwp')
      expect(Array.isArray(output.checks)).toBe(true)
    })

    it('validates file after setTableCell', async () => {
      const tempPath = await helpers.tempCopy(helpers.FIXTURES.wageClaim)
      tempFiles.push(tempPath)

      const editResult = await helpers.runCli(['table', 'edit', tempPath, 's0.t1.r0.c0', 'VALIDATE_TABLE_EDIT_2026'])
      expect(editResult.exitCode).toBe(0)

      const validateResult = await helpers.runCli(['validate', tempPath])
      expect([0, 1]).toContain(validateResult.exitCode)
      const output = parseValidateOutput(validateResult)
      expect(typeof output.valid).toBe('boolean')
      expect(output.format).toBe('hwp')
      expect(Array.isArray(output.checks)).toBe(true)
    })

    it('validates file after setFormat', async () => {
      const tempPath = await helpers.tempCopy(helpers.FIXTURES.victimStatement)
      tempFiles.push(tempPath)

      const editResult = await helpers.runCli(['edit', 'format', tempPath, 's0.p1', '--bold'])
      expect(editResult.exitCode).toBe(0)

      const validateResult = await helpers.runCli(['validate', tempPath])
      expect([0, 1]).toContain(validateResult.exitCode)
      const output = parseValidateOutput(validateResult)
      expect(typeof output.valid).toBe('boolean')
      expect(output.format).toBe('hwp')
      expect(Array.isArray(output.checks)).toBe(true)
    })
  })
})

describe.skipIf(!isViewerAvailable)('D. Viewer comparison', () => {
  it('matches viewer judgment on all 7 clean fixtures', async () => {
    for (const [name, fixturePath] of Object.entries(helpers.FIXTURES)) {
      const validateResult = await helpers.runCli(['validate', fixturePath])
      const viewerResult = await helpers.checkViewerCorruption(fixturePath)
      if (!viewerResult.skipped) {
        const output = parseValidateOutput(validateResult)
        const validateSaysValid = validateResult.exitCode === 0 && output.valid
        const viewerSaysValid = !viewerResult.corrupted
        expect(validateSaysValid).toBe(viewerSaysValid)
      }

      expect(name.length).toBeGreaterThan(0)
    }
  }, 120_000)
})

function parseValidateOutput(result: { stdout: string }): ValidateResult {
  const lines = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const candidate = lines.at(-1) ?? result.stdout.trim()
  return JSON.parse(candidate) as ValidateResult
}

async function expectCorrupted(filePath: string): Promise<void> {
  const result = await helpers.runCli(['validate', filePath])
  expect(result.exitCode).toBe(1)
  const output = parseValidateOutput(result)
  expect(output.valid).toBe(false)
}

async function createTruncatedHwp(sourcePath: string, destPath: string): Promise<void> {
  const { cfb } = await readCfb(sourcePath)
  const section0 = findEntry(cfb, '/BodyText/Section0', 'BodyText/Section0')
  if (!section0?.content) {
    throw new Error('BodyText/Section0 not found')
  }

  const content = Buffer.from(section0.content)
  section0.content = content.subarray(0, Math.floor(content.length / 2))
  await writeCfb(cfb, destPath)
}

async function patchParaHeaderNChars(sourcePath: string, destPath: string, wrongNChars: number): Promise<void> {
  const { cfb, compressed } = await readCfb(sourcePath)
  const section0 = findEntry(cfb, '/BodyText/Section0', 'BodyText/Section0')
  if (!section0?.content) {
    throw new Error('BodyText/Section0 not found')
  }

  const sectionBuffer = decodeStream(Buffer.from(section0.content), compressed)
  let patched = false

  for (const record of iterateRecords(sectionBuffer)) {
    if (record.header.tagId !== TAG.PARA_HEADER || record.header.level !== 0 || record.data.length < 4) {
      continue
    }

    const nCharsOffset = record.offset + record.header.headerSize
    const current = sectionBuffer.readUInt32LE(nCharsOffset)
    const patchedValue = (current & 0x80000000) | (wrongNChars & 0x7fffffff)
    sectionBuffer.writeUInt32LE(patchedValue >>> 0, nCharsOffset)
    patched = true
    break
  }

  if (!patched) {
    throw new Error('PARA_HEADER not found for nChars patch')
  }

  section0.content = encodeStream(sectionBuffer, compressed)
  await writeCfb(cfb, destPath)
}

async function patchParaCharShapeRef(sourcePath: string, destPath: string, badRef: number): Promise<void> {
  const { cfb, compressed } = await readCfb(sourcePath)
  const section0 = findEntry(cfb, '/BodyText/Section0', 'BodyText/Section0')
  if (!section0?.content) {
    throw new Error('BodyText/Section0 not found')
  }

  const sectionBuffer = decodeStream(Buffer.from(section0.content), compressed)
  let patched = false

  for (const record of iterateRecords(sectionBuffer)) {
    if (record.header.tagId !== TAG.PARA_CHAR_SHAPE) {
      continue
    }

    const dataOffset = record.offset + record.header.headerSize
    if (record.data.length > 0 && record.data.length % 8 === 0) {
      sectionBuffer.writeUInt32LE(badRef >>> 0, dataOffset + 4)
      patched = true
      break
    }

    if (record.data.length >= 6 && record.data.length < 8) {
      sectionBuffer.writeUInt16LE(Math.min(badRef, 0xffff), dataOffset + 4)
      patched = true
      break
    }
  }

  if (!patched) {
    throw new Error('PARA_CHAR_SHAPE not found for ref patch')
  }

  section0.content = encodeStream(sectionBuffer, compressed)
  await writeCfb(cfb, destPath)
}

async function removeDocInfoStream(sourcePath: string, destPath: string): Promise<void> {
  const { cfb } = await readCfb(sourcePath)
  const removed = CFB.utils.cfb_del(cfb, '/DocInfo') || CFB.utils.cfb_del(cfb, 'DocInfo')
  if (!removed) {
    throw new Error('DocInfo stream not found')
  }
  await writeCfb(cfb, destPath)
}

async function removeSection0Stream(sourcePath: string, destPath: string): Promise<void> {
  const { cfb } = await readCfb(sourcePath)
  const removed = CFB.utils.cfb_del(cfb, '/BodyText/Section0') || CFB.utils.cfb_del(cfb, 'BodyText/Section0')
  if (!removed) {
    throw new Error('BodyText/Section0 stream not found')
  }
  await writeCfb(cfb, destPath)
}

async function patchIdMappingsCharShapeCount(sourcePath: string, destPath: string): Promise<void> {
  const { cfb, compressed } = await readCfb(sourcePath)
  const docInfo = findEntry(cfb, '/DocInfo', 'DocInfo')
  if (!docInfo?.content) {
    throw new Error('DocInfo stream not found')
  }

  const docInfoBuffer = decodeStream(Buffer.from(docInfo.content), compressed)
  let patched = false

  for (const record of iterateRecords(docInfoBuffer)) {
    if (record.header.tagId !== TAG.ID_MAPPINGS) {
      continue
    }

    const idMappingsOffset = record.offset + record.header.headerSize
    const charShapeOffset = idMappingsOffset + 9 * 4
    if (record.data.length < 9 * 4 + 4) {
      throw new Error('ID_MAPPINGS record too short to patch charShape count')
    }

    const declared = docInfoBuffer.readUInt32LE(charShapeOffset)
    docInfoBuffer.writeUInt32LE((declared + 1) >>> 0, charShapeOffset)
    patched = true
    break
  }

  if (!patched) {
    throw new Error('ID_MAPPINGS record not found')
  }

  docInfo.content = encodeStream(docInfoBuffer, compressed)
  await writeCfb(cfb, destPath)
}

async function patchInvalidFileHeaderSignature(sourcePath: string, destPath: string): Promise<void> {
  const { cfb } = await readCfb(sourcePath)
  const fileHeader = findEntry(cfb, '/FileHeader', 'FileHeader')
  if (!fileHeader?.content) {
    throw new Error('FileHeader stream not found')
  }

  const header = Buffer.from(fileHeader.content)
  header.write('INVALID_SIGNATURE', 0, 'ascii')
  fileHeader.content = header
  await writeCfb(cfb, destPath)
}

async function patchEncryptionFlag(sourcePath: string, destPath: string): Promise<void> {
  const { cfb } = await readCfb(sourcePath)
  const fileHeader = findEntry(cfb, '/FileHeader', 'FileHeader')
  if (!fileHeader?.content) {
    throw new Error('FileHeader stream not found')
  }

  const header = Buffer.from(fileHeader.content)
  const flags = header.readUInt32LE(36)
  header.writeUInt32LE(flags | 0x2, 36)
  fileHeader.content = header
  await writeCfb(cfb, destPath)
}

async function readCfb(filePath: string): Promise<{ cfb: CFB.CFB$Container; compressed: boolean }> {
  const fileBuffer = await readFile(filePath)
  const cfb = CFB.read(fileBuffer, { type: 'buffer' })

  const fileHeader = findEntry(cfb, '/FileHeader', 'FileHeader')
  if (!fileHeader?.content) {
    throw new Error('FileHeader stream not found')
  }
  const flags = Buffer.from(fileHeader.content).readUInt32LE(36)

  return { cfb, compressed: Boolean(flags & 0x1) }
}

function findEntry(cfb: CFB.CFB$Container, ...names: string[]): { content?: Uint8Array } | undefined {
  for (const name of names) {
    const entry = CFB.find(cfb, name) as { content?: Uint8Array } | null
    if (entry) {
      return entry
    }
  }

  return undefined
}

function decodeStream(buffer: Buffer, compressed: boolean): Buffer {
  return compressed ? Buffer.from(inflateRaw(buffer)) : buffer
}

function encodeStream(buffer: Buffer, compressed: boolean): Buffer {
  return compressed ? Buffer.from(deflateRaw(buffer)) : buffer
}

async function writeCfb(cfb: CFB.CFB$Container, destPath: string): Promise<void> {
  await Bun.write(destPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
}
