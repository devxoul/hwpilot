import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadHwp } from '@/formats/hwp/reader'
import { parseHeader } from '@/formats/hwpx/header-parser'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { createTestHwpBinary, createTestHwpx } from '@/test-helpers'
import { editFormatCommand } from './edit-format'

const tmpPath = (name: string) => join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.hwpx`)

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

describe('editFormatCommand', () => {
  let testFile: string

  beforeEach(async () => {
    testFile = tmpPath('edit-format')
    const buffer = await createTestHwpx({ paragraphs: ['Hello'] })
    await Bun.write(testFile, buffer)
  })

  afterEach(async () => {
    try {
      await unlink(testFile)
    } catch {}
  })

  it('applies bold format', async () => {
    captureOutput()
    await editFormatCommand(testFile, 's0.p0', { bold: true })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.p0', format: { bold: true }, success: true })

    const archive = await loadHwpx(testFile)
    const header = parseHeader(await archive.getHeaderXml())
    const sections = await parseSections(archive)

    const runCharShapeRef = sections[0].paragraphs[0].runs[0].charShapeRef
    const runCharShape = header.charShapes.find((shape) => shape.id === runCharShapeRef)

    expect(header.charShapes.length).toBeGreaterThan(1)
    expect(runCharShape).toBeDefined()
    expect(runCharShape?.bold).toBe(true)
  })

  it('applies font size', async () => {
    captureOutput()
    await editFormatCommand(testFile, 's0.p0', { size: 14 })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.p0', format: { fontSize: 14 }, success: true })
  })

  it('applies color', async () => {
    captureOutput()
    await editFormatCommand(testFile, 's0.p0', { color: '#FF0000' })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.p0', format: { color: '#FF0000' }, success: true })
  })

  it('errors when no format options specified', async () => {
    captureOutput()
    await expect(editFormatCommand(testFile, 's0.p0', {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toBe('No format options specified')
  })

  it('errors for invalid ref', async () => {
    captureOutput()
    await expect(editFormatCommand(testFile, 'bad-ref', { bold: true })).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Invalid reference')
  })
})

describe('editFormatCommand HWP', () => {
  let hwpFile: string

  beforeEach(async () => {
    hwpFile = join(tmpdir(), `edit-format-hwp-${Date.now()}-${Math.random().toString(36).slice(2)}.hwp`)
    const buffer = await createTestHwpBinary({ paragraphs: ['Hello'] })
    await Bun.write(hwpFile, buffer)
  })

  afterEach(async () => {
    try {
      await unlink(hwpFile)
    } catch {}
  })

  it('applies bold format to HWP file', async () => {
    captureOutput()
    await editFormatCommand(hwpFile, 's0.p0', { bold: true })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ ref: 's0.p0', format: { bold: true }, success: true })

    const doc = await loadHwp(hwpFile)
    const charShapeRef = doc.sections[0].paragraphs[0].runs[0].charShapeRef
    const charShape = doc.header.charShapes.find((s) => s.id === charShapeRef)
    expect(charShape?.bold).toBe(true)
  })
})
