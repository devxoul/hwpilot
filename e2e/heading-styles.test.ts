import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { cleanupFiles, parseOutput, runCli, validateFile } from './helpers'

const tempFiles: string[] = []

function tempPath(suffix: string, ext = '.hwpx'): string {
  const p = join(tmpdir(), `e2e-heading-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  tempFiles.push(p)
  return p
}

async function runCliNoDaemon(args: string[]) {
  return runCli(args, { env: { HWPILOT_NO_DAEMON: '1' } })
}

afterEach(async () => {
  await cleanupFiles(tempFiles)
  tempFiles.length = 0
})

describe('Heading Styles — HWPX (created document)', () => {
  describe('A. Basic Heading Roundtrip', () => {
    it('creates HWPX, adds heading paragraph, and reads headingLevel', async () => {
      const hwpxFile = tempPath('hwpx-basic', '.hwpx')

      await runCliNoDaemon(['create', hwpxFile])
      await runCliNoDaemon(['paragraph', 'add', hwpxFile, 's0', '제1장 서론', '--heading', '1', '--position', 'end'])

      const readResult = await runCliNoDaemon(['read', hwpxFile, '--pretty'])
      const doc = parseOutput(readResult) as any
      const headingPara = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === '제1장 서론')

      expect(headingPara).toBeDefined()
      expect(headingPara.headingLevel).toBe(1)
      expect(headingPara.styleName).toBe('개요 1')
    })
  })

  describe('B. Mixed Heading and Body', () => {
    it('preserves mixed heading and body paragraph levels', async () => {
      const hwpxFile = tempPath('hwpx-mixed', '.hwpx')

      await runCliNoDaemon(['create', hwpxFile])
      await runCliNoDaemon(['paragraph', 'add', hwpxFile, 's0', '제1장 제목', '--heading', '1', '--position', 'end'])
      await runCliNoDaemon(['paragraph', 'add', hwpxFile, 's0', '본문 단락', '--position', 'end'])

      const readResult = await runCliNoDaemon(['read', hwpxFile, '--pretty'])
      const doc = parseOutput(readResult) as any
      const headingPara = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === '제1장 제목')
      const bodyPara = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === '본문 단락')

      expect(headingPara.headingLevel).toBe(1)
      expect(headingPara.styleName).toBe('개요 1')
      expect(bodyPara.headingLevel).toBeUndefined()
      expect(bodyPara.styleName).toBe('Normal')
    })
  })

  describe('C. Style Name Option', () => {
    it('applies heading style when --style name is used', async () => {
      const hwpxFile = tempPath('hwpx-style-name', '.hwpx')

      await runCliNoDaemon(['create', hwpxFile])
      await runCliNoDaemon([
        'paragraph',
        'add',
        hwpxFile,
        's0',
        '스타일 기반 제목',
        '--style',
        '개요 2',
        '--position',
        'end',
      ])

      const readResult = await runCliNoDaemon(['read', hwpxFile, '--pretty'])
      const doc = parseOutput(readResult) as any
      const para = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === '스타일 기반 제목')

      expect(para).toBeDefined()
      expect(para.styleName).toBe('개요 2')
      expect(para.headingLevel).toBe(2)
    })
  })

  describe('D. Raw XML Cross-Validation', () => {
    it('writes heading paragraph with correct hp:styleIDRef in section XML', async () => {
      const hwpxFile = tempPath('hwpx-xml-style-ref', '.hwpx')
      const marker = 'HWPX_HEADING_XML_2026'

      await runCliNoDaemon(['create', hwpxFile])
      await runCliNoDaemon(['paragraph', 'add', hwpxFile, 's0', marker, '--heading', '1', '--position', 'end'])

      const data = await readFile(hwpxFile)
      const zip = await JSZip.loadAsync(data)
      const xml = await zip.file('Contents/section0.xml')?.async('string')

      expect(xml).toBeDefined()
      expect(xml).toContain(marker)
      expect(xml).toContain('hp:styleIDRef="1"')
      expect(xml).toContain('hp:paraPrIDRef="1"')
    })
  })
})

describe('Heading Styles — HWP and conversion', () => {
  describe('A. HWP Roundtrip', () => {
    it('creates HWP, adds heading paragraph, and reads headingLevel', async () => {
      const hwpFile = tempPath('hwp-basic', '.hwp')

      await runCliNoDaemon(['create', hwpFile])
      await runCliNoDaemon(['paragraph', 'add', hwpFile, 's0', 'HWP 제목', '--heading', '1', '--position', 'end'])

      const readResult = await runCliNoDaemon(['read', hwpFile, '--pretty'])
      const doc = parseOutput(readResult) as any
      const para = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === 'HWP 제목')

      expect(para).toBeDefined()
      expect(para.headingLevel).toBe(1)
      expect(para.styleName).toBe('개요 1')
      await validateFile(hwpFile)
    })
  })

  describe('B. HWP -> HWPX conversion cross-validation', () => {
    it('preserves heading style mapping after convert', async () => {
      const hwpFile = tempPath('hwp-convert-source', '.hwp')
      const hwpxFile = tempPath('hwp-convert-target', '.hwpx')

      await runCliNoDaemon(['create', hwpFile])
      await runCliNoDaemon(['paragraph', 'add', hwpFile, 's0', '변환 제목', '--heading', '2', '--position', 'end'])
      await runCliNoDaemon(['convert', hwpFile, hwpxFile])

      const readResult = await runCliNoDaemon(['read', hwpxFile, '--pretty'])
      const doc = parseOutput(readResult) as any
      const para = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === '변환 제목')

      expect(para).toBeDefined()
      expect(para.styleName).toBe('개요 2')
      expect(para.styleRef).toBe(2)
      expect(para.paraShapeRef).toBe(2)
    })
  })
})

describe('Heading Styles — Error cases', () => {
  it('rejects --heading 0', async () => {
    const hwpxFile = tempPath('err-heading-zero', '.hwpx')
    await runCliNoDaemon(['create', hwpxFile])

    const result = await runCliNoDaemon([
      'paragraph',
      'add',
      hwpxFile,
      's0',
      '잘못된 heading 0',
      '--heading',
      '0',
      '--position',
      'end',
    ])

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Heading level must be between 1 and 7')
  })

  it('rejects --heading 8', async () => {
    const hwpxFile = tempPath('err-heading-eight', '.hwpx')
    await runCliNoDaemon(['create', hwpxFile])

    const result = await runCliNoDaemon([
      'paragraph',
      'add',
      hwpxFile,
      's0',
      '잘못된 heading 8',
      '--heading',
      '8',
      '--position',
      'end',
    ])

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Heading level must be between 1 and 7')
  })

  it('rejects using --heading and --style together', async () => {
    const hwpxFile = tempPath('err-heading-style-together', '.hwpx')
    await runCliNoDaemon(['create', hwpxFile])

    const result = await runCliNoDaemon([
      'paragraph',
      'add',
      hwpxFile,
      's0',
      '중복 옵션',
      '--heading',
      '1',
      '--style',
      '개요 1',
      '--position',
      'end',
    ])

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Cannot specify both --heading and --style')
  })
})

describe('Heading Styles — HWPX heading levels 3-7', () => {
  for (const level of [3, 4, 5, 6, 7]) {
    it(`creates HWPX with heading level ${level} and reads back correctly`, async () => {
      const hwpxFile = tempPath(`hwpx-level-${level}`, '.hwpx')

      await runCliNoDaemon(['create', hwpxFile])
      await runCliNoDaemon([
        'paragraph',
        'add',
        hwpxFile,
        's0',
        `레벨 ${level} 제목`,
        '--heading',
        String(level),
        '--position',
        'end',
      ])

      const readResult = await runCliNoDaemon(['read', hwpxFile, '--pretty'])
      const doc = parseOutput(readResult) as any
      const para = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === `레벨 ${level} 제목`)

      expect(para).toBeDefined()
      expect(para.headingLevel).toBe(level)
      expect(para.styleName).toBe(`개요 ${level}`)
    })
  }
})

describe('Heading Styles — --style by numeric ID', () => {
  it('resolves --style 3 to 개요 3 with headingLevel 3 on HWPX', async () => {
    const hwpxFile = tempPath('hwpx-style-numeric', '.hwpx')

    await runCliNoDaemon(['create', hwpxFile])
    await runCliNoDaemon([
      'paragraph',
      'add',
      hwpxFile,
      's0',
      '숫자 스타일 테스트',
      '--style',
      '3',
      '--position',
      'end',
    ])

    const readResult = await runCliNoDaemon(['read', hwpxFile, '--pretty'])
    const doc = parseOutput(readResult) as any
    const para = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === '숫자 스타일 테스트')

    expect(para).toBeDefined()
    expect(para.styleName).toBe('개요 3')
    expect(para.headingLevel).toBe(3)
  })
})

describe('Heading Styles — --style on HWP format', () => {
  it('applies heading style by name on HWP and reads back headingLevel', async () => {
    const hwpFile = tempPath('hwp-style-name', '.hwp')

    await runCliNoDaemon(['create', hwpFile])
    await runCliNoDaemon([
      'paragraph',
      'add',
      hwpFile,
      's0',
      'HWP 스타일 이름 테스트',
      '--style',
      '개요 2',
      '--position',
      'end',
    ])

    const readResult = await runCliNoDaemon(['read', hwpFile, '--pretty'])
    const doc = parseOutput(readResult) as any
    const para = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === 'HWP 스타일 이름 테스트')

    expect(para).toBeDefined()
    expect(para.headingLevel).toBe(2)
    expect(para.styleName).toBe('개요 2')
    await validateFile(hwpFile)
  })
})

describe('Heading Styles — HWP mixed heading + body', () => {
  it('heading paragraph has headingLevel, body paragraph does not', async () => {
    const hwpFile = tempPath('hwp-mixed', '.hwp')

    await runCliNoDaemon(['create', hwpFile])
    await runCliNoDaemon(['paragraph', 'add', hwpFile, 's0', 'HWP 개요 제목', '--heading', '1', '--position', 'end'])
    await runCliNoDaemon(['paragraph', 'add', hwpFile, 's0', 'HWP 본문 단락', '--position', 'end'])

    const readResult = await runCliNoDaemon(['read', hwpFile, '--pretty'])
    const doc = parseOutput(readResult) as any
    const headingPara = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === 'HWP 개요 제목')
    const bodyPara = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === 'HWP 본문 단락')

    expect(headingPara).toBeDefined()
    expect(headingPara.headingLevel).toBe(1)
    expect(headingPara.styleName).toBe('개요 1')

    expect(bodyPara).toBeDefined()
    expect(bodyPara.headingLevel).toBeUndefined()
    await validateFile(hwpFile)
  })
})

describe('Heading Styles — HWP→HWPX conversion headingLevel', () => {
  it('preserves headingLevel in read output after conversion', async () => {
    const hwpFile = tempPath('hwp-convert-heading-level', '.hwp')
    const hwpxFile = tempPath('hwpx-convert-heading-level', '.hwpx')

    await runCliNoDaemon(['create', hwpFile])
    await runCliNoDaemon([
      'paragraph',
      'add',
      hwpFile,
      's0',
      '변환 headingLevel 확인',
      '--heading',
      '3',
      '--position',
      'end',
    ])
    await runCliNoDaemon(['convert', hwpFile, hwpxFile])

    const readResult = await runCliNoDaemon(['read', hwpxFile, '--pretty'])
    const doc = parseOutput(readResult) as any
    const para = doc.sections[0].paragraphs.find((p: any) => p.runs[0]?.text === '변환 headingLevel 확인')

    expect(para).toBeDefined()
    expect(para.headingLevel).toBe(3)
    expect(para.styleName).toBe('개요 3')
    expect(para.styleRef).toBe(3)
  })
})

describe('Heading Styles — missing heading styles error', () => {
  it('fails with descriptive error when heading styles are absent from HWPX', async () => {
    const hwpxFile = tempPath('hwpx-no-heading-styles', '.hwpx')

    // Create HWPX then strip heading styles from header.xml
    await runCliNoDaemon(['create', hwpxFile])
    const data = await readFile(hwpxFile)
    const zip = await JSZip.loadAsync(data)
    const headerXml = await zip.file('Contents/header.xml')?.async('string')
    if (!headerXml) throw new Error('header.xml not found')

    // Remove all heading style entries (개요 1-7), keep only Normal
    const stripped = headerXml.replace(/<hh:style[^>]*hh:name="개요 \d"[^/]*\/>/g, '')
    zip.file('Contents/header.xml', stripped)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(hwpxFile, await zip.generateAsync({ type: 'nodebuffer' }))

    const result = await runCliNoDaemon([
      'paragraph',
      'add',
      hwpxFile,
      's0',
      '없는 스타일 테스트',
      '--heading',
      '1',
      '--position',
      'end',
    ])

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('not found')
  })
})

describe('Heading Styles — HWP→HWPX convert raw XML check', () => {
  it('produces hh:heading with correct hh:level in header.xml after conversion', async () => {
    const hwpFile = tempPath('hwp-convert-xml-check', '.hwp')
    const hwpxFile = tempPath('hwpx-convert-xml-check', '.hwpx')

    await runCliNoDaemon(['create', hwpFile])
    await runCliNoDaemon(['paragraph', 'add', hwpFile, 's0', 'XML 검증 제목', '--heading', '2', '--position', 'end'])
    await runCliNoDaemon(['convert', hwpFile, hwpxFile])

    const data = await readFile(hwpxFile)
    const zip = await JSZip.loadAsync(data)
    const headerXml = await zip.file('Contents/header.xml')?.async('string')

    expect(headerXml).toBeDefined()
    expect(headerXml).toContain('<hh:heading')
    expect(headerXml).toContain('hh:level="2"')
    expect(headerXml).toContain('hh:type="OUTLINE"')
  })
})
