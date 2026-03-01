import { afterEach, describe, expect, it, mock } from 'bun:test'
import { unlink } from 'node:fs/promises'
import { loadHwp } from '@/formats/hwp/reader'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { createCommand } from './create'

let logs: string[]
let errors: string[]
const origLog = console.log
const origError = console.error
const origExit = process.exit

const tempFiles: string[] = []

function tempPath(suffix = ''): string {
  const path = `/tmp/test-create-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}.hwpx`
  tempFiles.push(path)
  return path
}

function tempHwpPath(suffix = ''): string {
  const path = `/tmp/test-create-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}.hwp`
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
  for (const f of tempFiles) {
    try {
      await unlink(f)
    } catch {}
  }
  tempFiles.length = 0
})

describe('createCommand', () => {
  it('creates a blank HWPX document', async () => {
    const file = tempPath()

    captureOutput()
    await createCommand(file, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ file, success: true })

    const archive = await loadHwpx(file)
    const sections = await parseSections(archive)
    expect(sections).toHaveLength(1)
    expect(sections[0].paragraphs).toHaveLength(1)
  })

  it('errors when file already exists', async () => {
    const file = tempPath('-exists')
    await Bun.write(file, 'placeholder')

    captureOutput()
    await expect(createCommand(file, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('File already exists')
  })

  it('creates a valid .hwp file', async () => {
    const file = tempHwpPath()

    captureOutput()
    await createCommand(file, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ file, success: true })

    const doc = await loadHwp(file)
    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0].paragraphs).toHaveLength(1)
  })

  it('creates .hwp with custom font and size', async () => {
    const file = tempHwpPath('-font')

    captureOutput()
    await createCommand(file, { font: '바탕', size: '12' })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)

    const doc = await loadHwp(file)
    expect(doc.header.fonts[0].name).toBe('바탕')
    expect(doc.header.charShapes[0].fontSize).toBe(12)
  })

  it('rejects existing .hwp file', async () => {
    const file = tempHwpPath('-exists')
    await Bun.write(file, 'placeholder')

    captureOutput()
    await expect(createCommand(file, {})).rejects.toThrow('process.exit')
    restoreOutput()
    const output = JSON.parse(errors[0])
    expect(output.error).toContain('File already exists')
  })

  it('creates compressed .hwp by default', async () => {
    const file = tempHwpPath('-compressed')

    captureOutput()
    await createCommand(file, {})
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)

    const doc = await loadHwp(file)
    expect(doc.sections).toHaveLength(1)
    // The file was created with compressed=true (default), verify it reads back correctly
    expect(doc.header).toBeDefined()
  })

  it('outputs pretty JSON when --pretty', async () => {
    const file = tempPath('-pretty')

    captureOutput()
    await createCommand(file, { pretty: true })
    restoreOutput()

    expect(logs[0]).toContain('\n')
    const output = JSON.parse(logs[0])
    expect(output).toEqual({ file, success: true })
  })
})

import { describe, expect, it } from 'bun:test'
import JSZip from 'jszip'
import { createTestHwpx } from '@/test-helpers'
import { parseHeader } from '@/formats/hwpx/header-parser'

describe('createTestHwpx — heading styles', () => {
  async function getHeader() {
    const buf = await createTestHwpx()
    const zip = await JSZip.loadAsync(buf)
    const headerXml = await zip.file('Contents/header.xml')!.async('string')
    return parseHeader(headerXml)
  }

  it('has 8 styles total', async () => {
    const header = await getHeader()
    expect(header.styles).toHaveLength(8)
  })

  it('has Normal as style 0', async () => {
    const header = await getHeader()
    expect(header.styles[0].id).toBe(0)
    expect(header.styles[0].name).toBe('Normal')
  })

  it('has 개요 1 through 개요 7 as styles 1-7', async () => {
    const header = await getHeader()
    for (let i = 1; i <= 7; i++) {
      expect(header.styles[i].id).toBe(i)
      expect(header.styles[i].name).toBe(`개요 ${i}`)
      expect(header.styles[i].charShapeRef).toBe(i)
      expect(header.styles[i].paraShapeRef).toBe(i)
      expect(header.styles[i].type).toBe('PARA')
    }
  })

  it('has 8 charPr entries with heading charShapes bold and sized', async () => {
    const header = await getHeader()
    expect(header.charShapes).toHaveLength(8)

    // body charShape
    expect(header.charShapes[0].id).toBe(0)
    expect(header.charShapes[0].bold).toBe(false)

    // heading charShapes: bold, decreasing sizes
    const expectedSizes = [22, 18, 16, 14, 13, 12, 11]
    for (let i = 1; i <= 7; i++) {
      expect(header.charShapes[i].id).toBe(i)
      expect(header.charShapes[i].bold).toBe(true)
      expect(header.charShapes[i].fontSize).toBe(expectedSizes[i - 1])
    }
  })

  it('has 8 paraPr entries with heading levels', async () => {
    const header = await getHeader()
    expect(header.paraShapes).toHaveLength(8)

    // body paraPr
    expect(header.paraShapes[0].id).toBe(0)
    expect(header.paraShapes[0].align).toBe('justify')
    expect(header.paraShapes[0].headingLevel).toBeUndefined()

    // heading paraPrs
    for (let i = 1; i <= 7; i++) {
      expect(header.paraShapes[i].id).toBe(i)
      expect(header.paraShapes[i].align).toBe('left')
      expect(header.paraShapes[i].headingLevel).toBe(i)
    }
  })
})
