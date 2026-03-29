import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, readFile as fsReadFile, rm, stat, writeFile as fsWriteFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import JSZip from 'jszip'

import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import type { HwpDocument } from '@/types'

import { convertCommand, generateHwpx } from './convert'

let errors: string[]
const tempDirs: string[] = []
const origLog = console.log
const origError = console.error
const origExit = process.exit

const fixturePath = join(process.cwd(), 'e2e/fixtures/임금 등 청구의 소.hwp')

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`))
  tempDirs.push(dir)
  return dir
}

function captureOutput() {
  errors = []
  console.log = (_msg: string) => {}
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
  for (const dirPath of tempDirs) {
    await rm(dirPath, { recursive: true, force: true })
  }
  tempDirs.length = 0
})

describe('convertCommand', () => {
  it('converts markdown to hwpx', async () => {
    const dir = await makeTempDir('convert-md-to-hwpx')
    const inputFile = join(dir, 'input.md')
    const outputFile = join(dir, 'output.hwpx')

    await fsWriteFile(inputFile, '# Hello\n\nWorld', 'utf-8')
    await convertCommand(inputFile, outputFile, { force: true })

    const outputStat = await stat(outputFile)
    expect(outputStat.size).toBeGreaterThan(0)

    const outputBuffer = await fsReadFile(outputFile)
    expect(outputBuffer.byteLength).toBeGreaterThan(0)
  })

  it('converts hwp fixture to markdown', async () => {
    const dir = await makeTempDir('convert-hwp-to-md')
    const outputFile = join(dir, 'output.md')

    await convertCommand(fixturePath, outputFile, { force: true })

    const outputStat = await stat(outputFile)
    expect(outputStat.size).toBeGreaterThan(0)

    const markdown = await fsReadFile(outputFile, 'utf-8')
    expect(markdown.trim().length).toBeGreaterThan(0)
  })

  it('keeps backward compatibility for hwp to hwpx conversion', async () => {
    const dir = await makeTempDir('convert-hwp-to-hwpx')
    const outputFile = join(dir, 'output.hwpx')

    await convertCommand(fixturePath, outputFile, { force: true })

    const outputStat = await stat(outputFile)
    expect(outputStat.size).toBeGreaterThan(0)
  })

  it('handles unsupported conversion with clear error', async () => {
    const dir = await makeTempDir('convert-unsupported')
    const inputFile = join(dir, 'input.txt')
    const outputFile = join(dir, 'output.hwpx')
    await fsWriteFile(inputFile, 'plain text', 'utf-8')

    captureOutput()
    await expect(convertCommand(inputFile, outputFile, {})).rejects.toThrow('process.exit')
    restoreOutput()

    const output = JSON.parse(errors[0])
    expect(output.error).toContain('Unsupported conversion:')
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

    const dir = await makeTempDir('generate-hwpx')
    const outputFile = join(dir, 'generated.hwpx')
    await fsWriteFile(outputFile, hwpxBuffer)

    const archive = await loadHwpx(outputFile)
    const sections = await parseSections(archive)

    expect(sections).toHaveLength(1)
    expect(sections[0].paragraphs).toHaveLength(1)
    expect(sections[0].paragraphs[0].runs[0].text).toBe('Hello')
  })
})

describe('generateHwpx - heading level and style type', () => {
  it('writes hh:heading element with level attribute when paraShape has headingLevel > 0', async () => {
    const doc: HwpDocument = {
      format: 'hwp',
      sections: [
        {
          paragraphs: [
            {
              ref: 's0.p0',
              runs: [{ text: 'Heading 1', charShapeRef: 0 }],
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
        paraShapes: [{ id: 0, align: 'left', headingLevel: 1 }],
        styles: [{ id: 0, name: 'Normal', charShapeRef: 0, paraShapeRef: 0 }],
      },
    }

    const hwpxBuffer = await generateHwpx(doc)
    const zip = await JSZip.loadAsync(hwpxBuffer)
    const headerXml = await zip.file('Contents/header.xml')?.async('text')

    expect(headerXml).toBeDefined()
    expect(headerXml).toContain('<hh:heading')
    expect(headerXml).toContain('level="1"')
    expect(headerXml).toContain('type="OUTLINE"')
    expect(headerXml).toContain('idRef="0"')
  })

  it('does not write hh:heading element when paraShape has no headingLevel', async () => {
    const doc: HwpDocument = {
      format: 'hwp',
      sections: [
        {
          paragraphs: [
            {
              ref: 's0.p0',
              runs: [{ text: 'Body text', charShapeRef: 0 }],
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
    const headerXml = await zip.file('Contents/header.xml')?.async('text')

    expect(headerXml).toBeDefined()
    expect(headerXml).not.toContain('<hh:heading')
  })

  it('writes type attribute on hh:style when style has type defined', async () => {
    const doc: HwpDocument = {
      format: 'hwp',
      sections: [
        {
          paragraphs: [
            {
              ref: 's0.p0',
              runs: [{ text: 'Test', charShapeRef: 0 }],
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
        styles: [{ id: 0, name: 'Heading 1', charShapeRef: 0, paraShapeRef: 0, type: 'PARA' }],
      },
    }

    const hwpxBuffer = await generateHwpx(doc)
    const zip = await JSZip.loadAsync(hwpxBuffer)
    const headerXml = await zip.file('Contents/header.xml')?.async('text')

    expect(headerXml).toBeDefined()
    expect(headerXml).toContain('type="PARA"')
  })

  it('does not write type attribute on hh:style when style has no type', async () => {
    const doc: HwpDocument = {
      format: 'hwp',
      sections: [
        {
          paragraphs: [
            {
              ref: 's0.p0',
              runs: [{ text: 'Test', charShapeRef: 0 }],
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
    const headerXml = await zip.file('Contents/header.xml')?.async('text')

    expect(headerXml).toBeDefined()
    // Should not have type attribute on style (only hh:id, hh:name, etc.)
    const styleMatch = headerXml?.match(/<hh:style[^>]*>/)
    expect(styleMatch).toBeDefined()
    expect(styleMatch?.[0]).not.toContain('type=')
  })
})
