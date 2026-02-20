import { afterEach, describe, expect, it, mock } from 'bun:test'
import { readFile, unlink } from 'node:fs/promises'
import CFB from 'cfb'
import JSZip from 'jszip'
import { convertCommand } from '@/commands/convert'
import { createCommand } from '@/commands/create'
import { editFormatCommand } from '@/commands/edit-format'
import { editTextCommand } from '@/commands/edit-text'
import { imageExtractCommand, imageInsertCommand, imageListCommand } from '@/commands/image'
import { readCommand } from '@/commands/read'
import { tableEditCommand, tableReadCommand } from '@/commands/table'
import { textCommand } from '@/commands/text'
import { createTestHwpBinary, createTestHwpCfb, createTestHwpx } from '@/test-helpers'

let logs: string[]
let errors: string[]
const origLog = console.log
const origError = console.error
const origExit = process.exit
const tempFiles: string[] = []

function tempPath(name: string, ext = 'hwpx'): string {
  const path = `/tmp/integration-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  tempFiles.push(path)
  return path
}

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

function createMinimalHwp(): Buffer {
  const cfb = CFB.utils.cfb_new()
  const fileHeader = Buffer.alloc(256)
  fileHeader.write('HWP Document File', 0, 'ascii')
  fileHeader.writeUInt32LE(0, 36)
  CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
  CFB.utils.cfb_add(cfb, 'DocInfo', Buffer.alloc(0))
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}

afterEach(async () => {
  restoreOutput()
  for (const f of tempFiles) {
    try {
      await unlink(f)
    } catch {}
  }
  tempFiles.length = 0
})

describe('integration: full HWPX lifecycle', () => {
  it('create → read → edit text → edit format → read back → verify', async () => {
    const file = tempPath('lifecycle')

    captureOutput()
    await createCommand(file, { title: 'Initial Text' })
    restoreOutput()
    const createOut = JSON.parse(logs[0])
    expect(createOut.success).toBe(true)

    captureOutput()
    await readCommand(file, undefined, {})
    restoreOutput()
    const readOut = JSON.parse(logs[0])
    expect(readOut.format).toBe('hwpx')
    expect(readOut.sections).toHaveLength(1)
    expect(readOut.sections[0].paragraphs[0].runs[0].text).toBe('Initial Text')

    captureOutput()
    await editTextCommand(file, 's0.p0', 'Modified Text', {})
    restoreOutput()
    const editOut = JSON.parse(logs[0])
    expect(editOut.success).toBe(true)
    expect(editOut.ref).toBe('s0.p0')
    expect(editOut.text).toBe('Modified Text')

    captureOutput()
    await editFormatCommand(file, 's0.p0', { bold: true, color: '#FF0000' })
    restoreOutput()
    const fmtOut = JSON.parse(logs[0])
    expect(fmtOut.success).toBe(true)
    expect(fmtOut.format.bold).toBe(true)
    expect(fmtOut.format.color).toBe('#FF0000')

    captureOutput()
    await readCommand(file, 's0.p0', {})
    restoreOutput()
    const paraOut = JSON.parse(logs[0])
    expect(paraOut.runs[0].text).toBe('Modified Text')

    captureOutput()
    await textCommand(file, undefined, {})
    restoreOutput()
    const textOut = JSON.parse(logs[0])
    expect(textOut.text).toBe('Modified Text')
  })
})

describe('integration: table workflow', () => {
  it('create with table → table read → table edit → verify', async () => {
    const file = tempPath('table')
    const buffer = await createTestHwpx({
      paragraphs: ['Heading'],
      tables: [
        {
          rows: [
            ['A1', 'B1'],
            ['A2', 'B2'],
          ],
        },
      ],
    })
    await Bun.write(file, buffer)

    captureOutput()
    await tableReadCommand(file, 's0.t0', {})
    restoreOutput()
    const tableOut = JSON.parse(logs[0])
    expect(tableOut.ref).toBe('s0.t0')
    expect(tableOut.rows).toHaveLength(2)
    expect(tableOut.rows[0].cells[0].text).toBe('A1')
    expect(tableOut.rows[0].cells[1].text).toBe('B1')
    expect(tableOut.rows[1].cells[0].text).toBe('A2')

    captureOutput()
    await tableEditCommand(file, 's0.t0.r0.c0', 'Changed', {})
    restoreOutput()
    const editOut = JSON.parse(logs[0])
    expect(editOut.success).toBe(true)
    expect(editOut.ref).toBe('s0.t0.r0.c0')

    captureOutput()
    await tableReadCommand(file, 's0.t0', {})
    restoreOutput()
    const verifyOut = JSON.parse(logs[0])
    expect(verifyOut.rows[0].cells[0].text).toBe('Changed')
    expect(verifyOut.rows[0].cells[1].text).toBe('B1')
    expect(verifyOut.rows[1].cells[0].text).toBe('A2')

    captureOutput()
    await textCommand(file, undefined, {})
    restoreOutput()
    const textOut = JSON.parse(logs[0])
    expect(textOut.text).toContain('Heading')
    expect(textOut.text).toContain('Changed')
  })
})

describe('integration: image workflow', () => {
  it('create → insert image → verify BinData entry', async () => {
    const file = tempPath('image')
    const pngPath = tempPath('input', 'png')
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

    captureOutput()
    await createCommand(file, { title: 'With Image' })
    restoreOutput()
    expect(JSON.parse(logs[0]).success).toBe(true)

    await Bun.write(pngPath, pngBytes)

    captureOutput()
    await imageInsertCommand(file, pngPath, {})
    restoreOutput()
    const insertOut = JSON.parse(logs[0])
    expect(insertOut.success).toBe(true)
    expect(insertOut.binDataPath).toBe('BinData/image0.png')

    // imageInsert adds to BinData ZIP only, not to section XML hp:pic tags
    const fileData = await readFile(file)
    const zip = await JSZip.loadAsync(fileData)
    const entry = zip.file('BinData/image0.png')
    expect(entry).not.toBeNull()
    const entryData = await entry!.async('nodebuffer')
    expect(Buffer.compare(entryData, pngBytes)).toBe(0)
  })

  it('list and extract from doc with hp:pic images', async () => {
    const file = tempPath('image-pic')
    const extractPath = tempPath('extracted', 'png')
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const buffer = await createTestHwpx({
      paragraphs: ['Doc'],
      images: [{ name: 'photo', data: pngBytes, format: 'png' }],
    })
    await Bun.write(file, buffer)

    captureOutput()
    await imageListCommand(file, {})
    restoreOutput()
    const listOut = JSON.parse(logs[0])
    expect(listOut).toHaveLength(1)
    expect(listOut[0].ref).toBe('s0.img0')

    captureOutput()
    await imageExtractCommand(file, 's0.img0', extractPath, {})
    restoreOutput()
    const extractOut = JSON.parse(logs[0])
    expect(extractOut.success).toBe(true)

    const extracted = await readFile(extractPath)
    expect(Buffer.compare(extracted, pngBytes)).toBe(0)
  })
})

describe('integration: HWP read', () => {
  it('reads minimal HWP 5.0 file structure', async () => {
    const file = tempPath('hwp-read', 'hwp')
    await Bun.write(file, createMinimalHwp())

    captureOutput()
    await readCommand(file, undefined, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.format).toBe('hwp')
    expect(output.sections).toEqual([])
    expect(output.header).toBeDefined()
    expect(output.header.fonts).toEqual([])
  })
})

describe('integration: convert workflow', () => {
  it('convert HWP → HWPX and verify output', async () => {
    const hwpFile = tempPath('convert-in', 'hwp')
    const hwpxFile = tempPath('convert-out', 'hwpx')
    await Bun.write(hwpFile, createMinimalHwp())

    captureOutput()
    await convertCommand(hwpFile, hwpxFile, {})
    restoreOutput()
    const convertOut = JSON.parse(logs[0])
    expect(convertOut.success).toBe(true)
    expect(convertOut.input).toBe(hwpFile)
    expect(convertOut.output).toBe(hwpxFile)
    expect(convertOut.sections).toBe(0)
    expect(convertOut.paragraphs).toBe(0)

    const fileData = await readFile(hwpxFile)
    const zip = await JSZip.loadAsync(fileData)
    expect(zip.file('Contents/header.xml')).not.toBeNull()
    expect(zip.file('Contents/content.hpf')).not.toBeNull()
  })
})

describe('integration: error cases produce valid JSON', () => {
  it('file not found → valid JSON error', async () => {
    captureOutput()
    await expect(readCommand('/tmp/nonexistent.hwpx', undefined, {})).rejects.toThrow('process.exit')
    restoreOutput()

    expect(errors).toHaveLength(1)
    const output = JSON.parse(errors[0])
    expect(output.error).toBeDefined()
    expect(typeof output.error).toBe('string')
  })

  it('unsupported format → valid JSON error', async () => {
    const unsupportedFile = tempPath('unsupported')
    await Bun.write(unsupportedFile, Buffer.from('not a valid hwp or hwpx file'))
    captureOutput()
    await expect(readCommand(unsupportedFile, undefined, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Unsupported file format')
  })

  it('invalid ref → valid JSON error', async () => {
    const file = tempPath('err-ref')
    const buffer = await createTestHwpx({ paragraphs: ['text'] })
    await Bun.write(file, buffer)

    captureOutput()
    await expect(readCommand(file, 'badref', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Invalid reference')
  })

  it('ref not found → valid JSON error', async () => {
    const file = tempPath('err-notfound')
    const buffer = await createTestHwpx({ paragraphs: ['text'] })
    await Bun.write(file, buffer)

    captureOutput()
    await expect(readCommand(file, 's0.p99', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('not found')
  })

  it('HWP edit text → succeeds', async () => {
    const hwpFile = tempPath('hwp5-write', 'hwp')
    await Bun.write(hwpFile, await createTestHwpBinary({ paragraphs: ['Hello'] }))
    captureOutput()
    await editTextCommand(hwpFile, 's0.p0', 'Modified', {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.p0', text: 'Modified', success: true })
  })

  it('create existing file → valid JSON error', async () => {
    const file = tempPath('err-exists')
    await Bun.write(file, 'placeholder')

    captureOutput()
    await expect(createCommand(file, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('File already exists')
  })

  it('convert non-HWP input → valid JSON error', async () => {
    const hwpxFile = tempPath('convert-err')
    await Bun.write(hwpxFile, await createTestHwpx({ paragraphs: ['test'] }))
    captureOutput()
    await expect(convertCommand(hwpxFile, 'out.hwpx', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toBe('Input must be a HWP 5.0 file')
  })

  it('text command on HWP 5.0 → succeeds (read supported)', async () => {
    const hwpFile = tempPath('text-hwp5')
    await Bun.write(hwpFile, createTestHwpCfb())
    captureOutput()
    await textCommand(hwpFile, undefined, {})
    restoreOutput()
  })

  it('image on HWP 5.0 → valid JSON error', async () => {
    const hwpFile = tempPath('img-hwp5')
    await Bun.write(hwpFile, createTestHwpCfb())
    captureOutput()
    await expect(imageListCommand(hwpFile, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('HWP 5.0')
  })

  it('no format options → valid JSON error', async () => {
    const file = tempPath('err-nofmt')
    const buffer = await createTestHwpx({ paragraphs: ['text'] })
    await Bun.write(file, buffer)

    captureOutput()
    await expect(editFormatCommand(file, 's0.p0', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('No format options specified')
  })
})

describe('integration: --pretty flag', () => {
  it('all commands output valid pretty JSON', async () => {
    const file = tempPath('pretty')

    captureOutput()
    await createCommand(file, { title: 'Pretty', pretty: true })
    restoreOutput()
    expect(logs[0]).toContain('\n')
    expect(() => JSON.parse(logs[0])).not.toThrow()

    captureOutput()
    await readCommand(file, undefined, { pretty: true })
    restoreOutput()
    expect(logs[0]).toContain('\n')
    expect(() => JSON.parse(logs[0])).not.toThrow()

    captureOutput()
    await textCommand(file, undefined, { pretty: true })
    restoreOutput()
    expect(logs[0]).toContain('\n')
    expect(() => JSON.parse(logs[0])).not.toThrow()

    captureOutput()
    await editTextCommand(file, 's0.p0', 'Pretty text', { pretty: true })
    restoreOutput()
    expect(logs[0]).toContain('\n')
    expect(() => JSON.parse(logs[0])).not.toThrow()

    captureOutput()
    await editFormatCommand(file, 's0.p0', { bold: true, pretty: true })
    restoreOutput()
    expect(logs[0]).toContain('\n')
    expect(() => JSON.parse(logs[0])).not.toThrow()
  })

  it('table commands output valid pretty JSON', async () => {
    const file = tempPath('pretty-table')
    const buffer = await createTestHwpx({
      paragraphs: ['Text'],
      tables: [{ rows: [['Cell']] }],
    })
    await Bun.write(file, buffer)

    captureOutput()
    await tableReadCommand(file, 's0.t0', { pretty: true })
    restoreOutput()
    expect(logs[0]).toContain('\n')
    expect(() => JSON.parse(logs[0])).not.toThrow()

    captureOutput()
    await tableEditCommand(file, 's0.t0.r0.c0', 'New', { pretty: true })
    restoreOutput()
    expect(logs[0]).toContain('\n')
    expect(() => JSON.parse(logs[0])).not.toThrow()
  })

  it('image commands output valid pretty JSON', async () => {
    const file = tempPath('pretty-image')
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const buffer = await createTestHwpx({
      paragraphs: ['Text'],
      images: [{ name: 'pic', data: pngBytes, format: 'png' }],
    })
    await Bun.write(file, buffer)

    captureOutput()
    await imageListCommand(file, { pretty: true })
    restoreOutput()
    expect(logs[0]).toContain('\n')
    expect(() => JSON.parse(logs[0])).not.toThrow()
  })
})

describe('integration: all outputs are valid JSON', () => {
  it('success outputs are parseable JSON', async () => {
    const file = tempPath('json-check')

    captureOutput()
    await createCommand(file, { title: 'JSON check' })
    restoreOutput()
    expect(() => JSON.parse(logs[0])).not.toThrow()

    captureOutput()
    await readCommand(file, undefined, {})
    restoreOutput()
    expect(() => JSON.parse(logs[0])).not.toThrow()

    captureOutput()
    await readCommand(file, 's0.p0', {})
    restoreOutput()
    expect(() => JSON.parse(logs[0])).not.toThrow()

    captureOutput()
    await textCommand(file, undefined, {})
    restoreOutput()
    expect(() => JSON.parse(logs[0])).not.toThrow()

    captureOutput()
    await editTextCommand(file, 's0.p0', 'New', {})
    restoreOutput()
    expect(() => JSON.parse(logs[0])).not.toThrow()

    captureOutput()
    await editFormatCommand(file, 's0.p0', { bold: true })
    restoreOutput()
    expect(() => JSON.parse(logs[0])).not.toThrow()
  })

  it('error outputs are parseable JSON with error field', async () => {
    const hwpFile = tempPath('json-hwp')
    await Bun.write(hwpFile, createTestHwpCfb())
    const unsupportedFile = tempPath('json-unsupported')
    await Bun.write(unsupportedFile, Buffer.from('not a valid file'))
    const hwpxFile = tempPath('json-hwpx')
    await Bun.write(hwpxFile, await createTestHwpx({ paragraphs: ['test'] }))

    const errorCommands = [
      () => readCommand('/tmp/nonexistent.hwpx', undefined, {}),
      () => readCommand(unsupportedFile, undefined, {}),
      () => editTextCommand(hwpFile, 's0.p0', 'text', {}),
      () => editFormatCommand(hwpFile, 's0.p0', { bold: true }),
      () => convertCommand(hwpxFile, 'out.hwpx', {}),
      () => imageListCommand(hwpFile, {}),
    ]

    for (const cmd of errorCommands) {
      captureOutput()
      await expect(cmd()).rejects.toThrow('process.exit')
      restoreOutput()

      expect(errors).toHaveLength(1)
      const output = JSON.parse(errors[0])
      expect(output).toHaveProperty('error')
      expect(typeof output.error).toBe('string')
      expect(output.error.length).toBeGreaterThan(0)
    }
  })
})
