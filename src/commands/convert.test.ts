import { afterEach, describe, expect, it, mock } from 'bun:test'
import { unlink, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { createTestHwpCfb, createTestHwpx } from '@/test-helpers'
import type { HwpDocument } from '@/types'
import { convertCommand, generateHwpx } from './convert'

let logs: string[]
let errors: string[]
const tempFiles: string[] = []
const origLog = console.log
const origError = console.error
const origExit = process.exit

function tempPath(name: string, ext: string): string {
  const path = `/tmp/${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
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

afterEach(async () => {
  restoreOutput()
  for (const filePath of tempFiles) {
    try {
      await unlink(filePath)
    } catch {}
  }
  tempFiles.length = 0
})

describe('convertCommand', () => {
  it('errors for non-HWP input', async () => {
    const hwpxFile = tempPath('convert-input', 'hwpx')
    await Bun.write(hwpxFile, await createTestHwpx({ paragraphs: ['test'] }))
    captureOutput()
    await expect(convertCommand(hwpxFile, 'out.hwpx', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toBe('Input must be a HWP 5.0 file')
  })

  it('errors for non-.hwpx output extension', async () => {
    const hwpFile = tempPath('convert-hwp', 'hwp')
    await Bun.write(hwpFile, createTestHwpCfb())
    captureOutput()
    await expect(convertCommand(hwpFile, 'out.hwp', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toBe('Output must be a .hwpx file')
  })

  it('errors when input file does not exist', async () => {
    const outputFile = tempPath('convert-out', 'hwpx')

    captureOutput()
    await expect(convertCommand('/tmp/nonexistent.hwp', outputFile, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('ENOENT')
  })

  it('errors when output file already exists without --force', async () => {
    const hwpFile = tempPath('convert-hwp', 'hwp')
    const outputFile = tempPath('convert-out', 'hwpx')

    await Bun.write(hwpFile, createTestHwpCfb())
    await Bun.write(outputFile, await createTestHwpx({ paragraphs: ['existing'] }))

    captureOutput()
    await expect(convertCommand(hwpFile, outputFile, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('File already exists')
  })

  it('overwrites existing output file with --force flag', async () => {
    const hwpFile = tempPath('convert-hwp', 'hwp')
    const outputFile = tempPath('convert-out', 'hwpx')

    await Bun.write(hwpFile, createTestHwpCfb())
    await Bun.write(outputFile, await createTestHwpx({ paragraphs: ['existing'] }))

    captureOutput()
    await convertCommand(hwpFile, outputFile, { force: true })
    restoreOutput()

    expect(logs.length).toBeGreaterThan(0)
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })

  it('succeeds when output file does not exist', async () => {
    const hwpFile = tempPath('convert-hwp', 'hwp')
    const outputFile = tempPath('convert-out', 'hwpx')

    await Bun.write(hwpFile, createTestHwpCfb())

    captureOutput()
    await convertCommand(hwpFile, outputFile, {})
    restoreOutput()

    expect(logs.length).toBeGreaterThan(0)
    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)
  })
})

describe('generateHwpx', () => {
  it('builds a valid HWPX archive from a document model', async () => {
    const doc: HwpDocument = {
      format: 'hwp',
      sections: [
        {
          paragraphs: [
            {
              ref: 's0.p0',
              runs: [{ text: 'Hello', charShapeRef: 0 }],
              paraShapeRef: 0,
              styleRef: 0,
            },
          ],
          tables: [],
          images: [],
        },
      ],
      header: {
        fonts: [{ id: 0, name: '맑은 고딕' }],
        charShapes: [
          {
            id: 0,
            fontRef: 0,
            fontSize: 10,
            bold: false,
            italic: false,
            underline: false,
            color: '#000000',
          },
        ],
        paraShapes: [{ id: 0, align: 'left' }],
        styles: [{ id: 0, name: 'Normal', charShapeRef: 0, paraShapeRef: 0 }],
      },
    }

    const hwpxBuffer = await generateHwpx(doc)
    const zip = await JSZip.loadAsync(hwpxBuffer)

    expect(zip.file('Contents/header.xml')).toBeDefined()
    expect(zip.file('Contents/section0.xml')).toBeDefined()

    const outputFile = tempPath('generated', 'hwpx')
    await writeFile(outputFile, hwpxBuffer)

    const archive = await loadHwpx(outputFile)
    const sections = await parseSections(archive)

    expect(sections).toHaveLength(1)
    expect(sections[0].paragraphs).toHaveLength(1)
    expect(sections[0].paragraphs[0].runs[0].text).toBe('Hello')
  })
})
