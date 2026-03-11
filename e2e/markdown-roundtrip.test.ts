import { afterEach, describe, expect, it } from 'bun:test'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseOutput, runCli } from './helpers'

const tempFiles: string[] = []

function tempPath(suffix: string, ext: string): string {
  const path = join(tmpdir(), `e2e-md-roundtrip-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)
  tempFiles.push(path)
  return path
}

afterEach(async () => {
  for (const f of tempFiles) {
    await rm(f, { force: true })
  }
  tempFiles.length = 0
})

async function assertConvertSuccess(input: string, output: string): Promise<void> {
  const result = await runCli(['convert', input, output, '--force'])
  const payload = parseOutput(result) as { success?: boolean }
  expect(payload.success).toBe(true)
}

describe('Markdown round-trip conversion', () => {
  it('round-trips plain text through HWPX', async () => {
    const mdFile = tempPath('plain-input', 'md')
    const hwpxFile = tempPath('plain-middle', 'hwpx')
    const mdFile2 = tempPath('plain-output', 'md')
    await writeFile(mdFile, 'Paragraph one\n\nParagraph two\n\nParagraph three', 'utf-8')

    await assertConvertSuccess(mdFile, hwpxFile)
    await assertConvertSuccess(hwpxFile, mdFile2)

    const mdContent = await readFile(mdFile2, 'utf-8')
    expect(mdContent).toContain('Paragraph one')
    expect(mdContent).toContain('Paragraph two')
    expect(mdContent).toContain('Paragraph three')
  })

  it('round-trips headings through HWPX', async () => {
    const mdFile = tempPath('heading-input', 'md')
    const hwpxFile = tempPath('heading-middle', 'hwpx')
    const mdFile2 = tempPath('heading-output', 'md')
    await writeFile(mdFile, '# Title\n\n## Subtitle\n\nBody text', 'utf-8')

    await assertConvertSuccess(mdFile, hwpxFile)
    await assertConvertSuccess(hwpxFile, mdFile2)

    const mdContent = await readFile(mdFile2, 'utf-8')
    expect(mdContent).toContain('# Title')
    expect(mdContent).toContain('## Subtitle')
  })

  it('round-trips bold and italic text through HWPX', async () => {
    const mdFile = tempPath('format-input', 'md')
    const hwpxFile = tempPath('format-middle', 'hwpx')
    const mdFile2 = tempPath('format-output', 'md')
    await writeFile(mdFile, 'Normal **bold** *italic* ***both***', 'utf-8')

    await assertConvertSuccess(mdFile, hwpxFile)
    await assertConvertSuccess(hwpxFile, mdFile2)

    const mdContent = await readFile(mdFile2, 'utf-8')
    expect(mdContent).toContain('bold')
    expect(mdContent).toContain('italic')
  })

  it('round-trips table content through HWPX', async () => {
    const mdFile = tempPath('table-input', 'md')
    const hwpxFile = tempPath('table-middle', 'hwpx')
    const mdFile2 = tempPath('table-output', 'md')
    await writeFile(mdFile, '| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |', 'utf-8')

    await assertConvertSuccess(mdFile, hwpxFile)
    await assertConvertSuccess(hwpxFile, mdFile2)

    const mdContent = await readFile(mdFile2, 'utf-8')
    expect(mdContent).toContain('Name')
    expect(mdContent).toContain('Age')
    expect(mdContent).toContain('Alice')
    expect(mdContent).toContain('Bob')
  })

  it('round-trips mixed markdown document through HWPX', async () => {
    const mdFile = tempPath('mixed-input', 'md')
    const hwpxFile = tempPath('mixed-middle', 'hwpx')
    const mdFile2 = tempPath('mixed-output', 'md')
    await writeFile(
      mdFile,
      '# Report\n\nIntroduction paragraph.\n\n## Data\n\n| Col1 | Col2 |\n|------|------|\n| A | B |\n\n## Conclusion\n\nFinal paragraph.',
      'utf-8',
    )

    await assertConvertSuccess(mdFile, hwpxFile)
    await assertConvertSuccess(hwpxFile, mdFile2)

    const mdContent = await readFile(mdFile2, 'utf-8')
    expect(mdContent).toContain('Report')
    expect(mdContent).toContain('Introduction')
    expect(mdContent).toContain('Data')
    expect(mdContent).toContain('Col1')
    expect(mdContent).toContain('Col2')
    expect(mdContent).toContain('A')
    expect(mdContent).toContain('B')
    expect(mdContent).toContain('Conclusion')
    expect(mdContent).toContain('Final')
  })

  it('round-trips markdown through HWP', async () => {
    const mdFile = tempPath('hwp-input', 'md')
    const hwpFile = tempPath('hwp-middle', 'hwp')
    const mdFile2 = tempPath('hwp-output', 'md')
    await writeFile(mdFile, '# Hello\n\nWorld paragraph', 'utf-8')

    await assertConvertSuccess(mdFile, hwpFile)
    await assertConvertSuccess(hwpFile, mdFile2)

    const mdContent = await readFile(mdFile2, 'utf-8')
    expect(mdContent).toContain('Hello')
    expect(mdContent).toContain('World paragraph')
  })

  it('preserves lossy element text content through HWPX', async () => {
    const mdFile = tempPath('lossy-input', 'md')
    const hwpxFile = tempPath('lossy-middle', 'hwpx')
    const mdFile2 = tempPath('lossy-output', 'md')
    await writeFile(mdFile, 'Code: `inline code`\n\n> Blockquote text\n\n[Link text](https://example.com)', 'utf-8')

    await assertConvertSuccess(mdFile, hwpxFile)
    await assertConvertSuccess(hwpxFile, mdFile2)

    const mdContent = await readFile(mdFile2, 'utf-8')
    expect(mdContent).toContain('inline code')
    expect(mdContent).toContain('Blockquote text')
    expect(mdContent).toContain('Link text')
  })
})
