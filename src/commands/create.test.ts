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

  it('creates with title text', async () => {
    const file = tempPath('-title')

    captureOutput()
    await createCommand(file, { title: 'Hello World' })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output.success).toBe(true)

    const archive = await loadHwpx(file)
    const sections = await parseSections(archive)
    expect(sections[0].paragraphs[0].runs[0].text).toBe('Hello World')
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
    await createCommand(file, { title: '테스트' })
    restoreOutput()

    const output = JSON.parse(logs[0])
    expect(output).toEqual({ file, success: true })

    const doc = await loadHwp(file)
    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('테스트')
  })

  it('creates .hwp with custom font and size', async () => {
    const file = tempHwpPath('-font')

    captureOutput()
    await createCommand(file, { title: '제목', font: '바탕', size: '12' })
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
