import { describe, expect, it } from 'bun:test'
import { headingStyleName } from './heading-styles'
import { markdownToHwp } from './to-hwp'

function findStyleIdByName(doc: ReturnType<typeof markdownToHwp>, name: string): number {
  const style = doc.header.styles.find((item) => item.name === name)
  if (!style) {
    throw new Error(`Style not found: ${name}`)
  }

  return style.id
}

describe('markdownToHwp', () => {
  it('converts plain paragraph into one section with one paragraph and one run', () => {
    const doc = markdownToHwp('Hello world')

    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0].paragraphs).toHaveLength(1)
    expect(doc.sections[0].paragraphs[0].runs).toEqual([{ text: 'Hello world', charShapeRef: 0 }])
  })

  it('converts two markdown paragraphs into two HWP paragraphs', () => {
    const doc = markdownToHwp('First\n\nSecond')

    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0].paragraphs).toHaveLength(2)
    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('First')
    expect(doc.sections[0].paragraphs[1].runs[0].text).toBe('Second')
  })

  it('marks bold text with bold char shape', () => {
    const doc = markdownToHwp('**bold**')
    const run = doc.sections[0].paragraphs[0].runs[0]
    const shape = doc.header.charShapes[run.charShapeRef]

    expect(run.text).toBe('bold')
    expect(shape.bold).toBe(true)
    expect(shape.italic).toBe(false)
  })

  it('marks italic text with italic char shape', () => {
    const doc = markdownToHwp('*italic*')
    const run = doc.sections[0].paragraphs[0].runs[0]
    const shape = doc.header.charShapes[run.charShapeRef]

    expect(run.text).toBe('italic')
    expect(shape.italic).toBe(true)
    expect(shape.bold).toBe(false)
  })

  it('marks nested strong emphasis text as bold and italic', () => {
    const doc = markdownToHwp('***bold italic***')
    const run = doc.sections[0].paragraphs[0].runs[0]
    const shape = doc.header.charShapes[run.charShapeRef]

    expect(run.text).toBe('bold italic')
    expect(shape.bold).toBe(true)
    expect(shape.italic).toBe(true)
  })

  it('drops strikethrough formatting but keeps text', () => {
    const doc = markdownToHwp('~~strikethrough~~')
    const run = doc.sections[0].paragraphs[0].runs[0]
    const shape = doc.header.charShapes[run.charShapeRef]

    expect(run.text).toBe('strikethrough')
    expect(shape.bold).toBe(false)
    expect(shape.italic).toBe(false)
    expect(shape.underline).toBe(false)
  })

  it('maps heading level 1 to style 개요 1', () => {
    const doc = markdownToHwp('# Heading 1')
    const paragraph = doc.sections[0].paragraphs[0]
    const styleId = findStyleIdByName(doc, headingStyleName(1))

    expect(paragraph.styleRef).toBe(styleId)
  })

  it('maps heading level 2 to style 개요 2', () => {
    const doc = markdownToHwp('## Heading 2')
    const paragraph = doc.sections[0].paragraphs[0]
    const styleId = findStyleIdByName(doc, headingStyleName(2))

    expect(paragraph.styleRef).toBe(styleId)
  })

  it('converts a GFM table to one HWP table with rows and cells', () => {
    const doc = markdownToHwp('| A | B |\n| --- | --- |\n| C | D |')

    expect(doc.sections[0].tables).toHaveLength(1)
    expect(doc.sections[0].tables[0].rows).toHaveLength(2)
    expect(doc.sections[0].tables[0].rows[0].cells).toHaveLength(2)
    expect(doc.sections[0].tables[0].rows[1].cells).toHaveLength(2)
  })

  it('keeps table cell text content', () => {
    const doc = markdownToHwp('| Name | Role |\n| --- | --- |\n| Alice | Dev |')
    const table = doc.sections[0].tables[0]

    expect(table.rows[0].cells[0].paragraphs[0].runs[0].text).toBe('Name')
    expect(table.rows[0].cells[1].paragraphs[0].runs[0].text).toBe('Role')
    expect(table.rows[1].cells[0].paragraphs[0].runs[0].text).toBe('Alice')
    expect(table.rows[1].cells[1].paragraphs[0].runs[0].text).toBe('Dev')
  })

  it('preserves column alignment in GFM table cells', () => {
    const md = '| Left | Center | Right |\n|:---|:---:|---:|\n| a | b | c |'
    const doc = markdownToHwp(md)
    const table = doc.sections[0].tables[0]

    const leftParaShapeId = table.rows[0].cells[0].paragraphs[0].paraShapeRef
    const centerParaShapeId = table.rows[0].cells[1].paragraphs[0].paraShapeRef
    const rightParaShapeId = table.rows[0].cells[2].paragraphs[0].paraShapeRef

    const leftParaShape = doc.header.paraShapes.find((ps) => ps.id === leftParaShapeId)
    const centerParaShape = doc.header.paraShapes.find((ps) => ps.id === centerParaShapeId)
    const rightParaShape = doc.header.paraShapes.find((ps) => ps.id === rightParaShapeId)

    expect(leftParaShape?.align).toBe('left')
    expect(centerParaShape?.align).toBe('center')
    expect(rightParaShape?.align).toBe('right')
  })

  it('converts unordered list items with bullet prefix', () => {
    const doc = markdownToHwp('- Item 1\n- Item 2')

    expect(doc.sections[0].paragraphs).toHaveLength(2)
    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('• Item 1')
    expect(doc.sections[0].paragraphs[1].runs[0].text).toBe('• Item 2')
  })

  it('converts ordered list items with numeric prefix', () => {
    const doc = markdownToHwp('1. First\n2. Second')

    expect(doc.sections[0].paragraphs).toHaveLength(2)
    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('1. First')
    expect(doc.sections[0].paragraphs[1].runs[0].text).toBe('2. Second')
  })

  it('uses monospace font for inline code', () => {
    const doc = markdownToHwp('Use `code` here')
    const codeRun = doc.sections[0].paragraphs[0].runs.find((run) => run.text === 'code')

    expect(codeRun).toBeDefined()
    const shape = doc.header.charShapes[codeRun!.charShapeRef]
    expect(shape.fontRef).toBe(1)
  })

  it('uses monospace font for fenced code block lines', () => {
    const doc = markdownToHwp('```ts\nconst x = 1\nconsole.log(x)\n```')

    expect(doc.sections[0].paragraphs).toHaveLength(2)
    for (const paragraph of doc.sections[0].paragraphs) {
      const shape = doc.header.charShapes[paragraph.runs[0].charShapeRef]
      expect(shape.fontRef).toBe(1)
    }
  })

  it('prefixes blockquote paragraphs with >', () => {
    const doc = markdownToHwp('> blockquote')

    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('> blockquote')
  })

  it('converts link to text plus URL suffix', () => {
    const doc = markdownToHwp('[text](https://example.com)')

    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('text (https://example.com)')
  })

  it('splits sections on thematic break', () => {
    const doc = markdownToHwp('First\n\n---\n\nSecond')

    expect(doc.sections).toHaveLength(2)
  })

  it('creates two sections for Section 1 and Section 2 around thematic break', () => {
    const doc = markdownToHwp('Section 1\n\n---\n\nSection 2')

    expect(doc.sections).toHaveLength(2)
    expect(doc.sections[0].paragraphs[0].runs[0].text).toBe('Section 1')
    expect(doc.sections[1].paragraphs[0].runs[0].text).toBe('Section 2')
  })

  it('includes default and monospace fonts in header', () => {
    const doc = markdownToHwp('text')

    expect(doc.header.fonts.length).toBeGreaterThanOrEqual(2)
    expect(doc.header.fonts[0].name).toBe('맑은 고딕')
    expect(doc.header.fonts[1].name).toBe('Courier New')
  })

  it('keeps header char shape references self-consistent', () => {
    const doc = markdownToHwp('**bold** and `code`')
    const maxCharShapeRef = doc.header.charShapes.length - 1

    for (const section of doc.sections) {
      for (const paragraph of section.paragraphs) {
        for (const run of paragraph.runs) {
          expect(run.charShapeRef).toBeGreaterThanOrEqual(0)
          expect(run.charShapeRef).toBeLessThanOrEqual(maxCharShapeRef)
        }
      }
    }

    for (const style of doc.header.styles) {
      expect(style.charShapeRef).toBeGreaterThanOrEqual(0)
      expect(style.charShapeRef).toBeLessThanOrEqual(maxCharShapeRef)
    }
  })

  it('includes body style and heading styles in header', () => {
    const doc = markdownToHwp('# Title')
    const styleNames = doc.header.styles.map((style) => style.name)

    expect(styleNames).toContain('본문')
    for (let level = 1; level <= 6; level++) {
      expect(styleNames).toContain(headingStyleName(level))
    }
  })

  it('captures markdown image as HWP image entry', () => {
    const doc = markdownToHwp('![alt](./image.png)')

    expect(doc.sections[0].images).toHaveLength(1)
    expect(doc.sections[0].images[0].binDataPath).toBe('./image.png')
    expect(doc.sections[0].images[0].format).toBe('png')
  })
})
