import { afterEach, describe, expect, it, mock } from 'bun:test'
import { readFile, unlink } from 'node:fs/promises'
import JSZip from 'jszip'
import { createTestHwpx } from '@/test-helpers'
import { imageExtractCommand, imageInsertCommand, imageListCommand, imageReplaceCommand } from './image'

const TEST_FILE = '/tmp/test-image.hwpx'
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47])

let logs: string[]
let errors: string[]
const origLog = console.log
const origError = console.error
const origExit = process.exit

function captureOutput() {
  logs = []
  errors = []
  console.log = (msg: string) => logs.push(msg)
  console.error = (msg: string) => errors.push(msg)
  process.exit = mock(() => {
    throw new Error('process.exit')
  }) as never
}

function restoreOutput() {
  console.log = origLog
  console.error = origError
  process.exit = origExit
}

afterEach(restoreOutput)

describe('imageListCommand', () => {
  it('lists images with correct ref and path', async () => {
    const buffer = await createTestHwpx({
      paragraphs: ['Hello'],
      images: [{ name: 'test', data: PNG_BYTES, format: 'png' }],
    })
    await Bun.write(TEST_FILE, buffer)

    captureOutput()
    await imageListCommand(TEST_FILE, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toHaveLength(1)
    expect(output[0].ref).toBe('s0.img0')
    expect(output[0].binDataPath).toBe('BinData/test.png')
    expect(output[0].format).toBe('png')
    expect(output[0].width).toBe(200)
    expect(output[0].height).toBe(150)
  })

  it('returns empty array when no images', async () => {
    const buffer = await createTestHwpx({ paragraphs: ['Hello'] })
    await Bun.write(TEST_FILE, buffer)

    captureOutput()
    await imageListCommand(TEST_FILE, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual([])
  })
})

describe('imageExtractCommand', () => {
  const OUTPUT_PATH = '/tmp/extracted-test.png'

  afterEach(async () => {
    try {
      await unlink(OUTPUT_PATH)
    } catch {}
  })

  it('extracts image to output file', async () => {
    const buffer = await createTestHwpx({
      paragraphs: ['Hello'],
      images: [{ name: 'test', data: PNG_BYTES, format: 'png' }],
    })
    await Bun.write(TEST_FILE, buffer)

    captureOutput()
    await imageExtractCommand(TEST_FILE, 's0.img0', OUTPUT_PATH, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.img0')
    expect(output.outputPath).toBe(OUTPUT_PATH)
    expect(output.success).toBe(true)

    const extracted = await readFile(OUTPUT_PATH)
    expect(Buffer.compare(extracted, PNG_BYTES)).toBe(0)
  })

  it('errors for non-image ref', async () => {
    const buffer = await createTestHwpx({
      paragraphs: ['Hello'],
      images: [{ name: 'test', data: PNG_BYTES, format: 'png' }],
    })
    await Bun.write(TEST_FILE, buffer)

    captureOutput()
    await expect(imageExtractCommand(TEST_FILE, 's0.p0', OUTPUT_PATH, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Not an image reference')
  })
})

describe('imageInsertCommand', () => {
  const INPUT_IMAGE = '/tmp/insert-test.png'

  afterEach(async () => {
    try {
      await unlink(INPUT_IMAGE)
    } catch {}
  })

  it('inserts image into BinData', async () => {
    const buffer = await createTestHwpx({ paragraphs: ['Hello'] })
    await Bun.write(TEST_FILE, buffer)
    await Bun.write(INPUT_IMAGE, PNG_BYTES)

    captureOutput()
    await imageInsertCommand(TEST_FILE, INPUT_IMAGE, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.binDataPath).toBe('BinData/image0.png')
    expect(output.success).toBe(true)

    const fileData = await readFile(TEST_FILE)
    const zip = await JSZip.loadAsync(fileData)
    const entry = zip.file('BinData/image0.png')
    expect(entry).not.toBeNull()
    const entryData = await entry!.async('nodebuffer')
    expect(Buffer.compare(entryData, PNG_BYTES)).toBe(0)
  })
})

describe('imageReplaceCommand', () => {
  const NEW_IMAGE = '/tmp/replace-test.png'
  const NEW_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])

  afterEach(async () => {
    try {
      await unlink(NEW_IMAGE)
    } catch {}
  })

  it('replaces image binary data', async () => {
    const buffer = await createTestHwpx({
      paragraphs: ['Hello'],
      images: [{ name: 'test', data: PNG_BYTES, format: 'png' }],
    })
    await Bun.write(TEST_FILE, buffer)
    await Bun.write(NEW_IMAGE, NEW_PNG)

    captureOutput()
    await imageReplaceCommand(TEST_FILE, 's0.img0', NEW_IMAGE, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.ref).toBe('s0.img0')
    expect(output.binDataPath).toBe('BinData/test.png')
    expect(output.success).toBe(true)

    const fileData = await readFile(TEST_FILE)
    const zip = await JSZip.loadAsync(fileData)
    const entry = zip.file('BinData/test.png')
    expect(entry).not.toBeNull()
    const entryData = await entry!.async('nodebuffer')
    expect(Buffer.compare(entryData, NEW_PNG)).toBe(0)
  })
})
