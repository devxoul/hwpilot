import { describe, expect, test } from 'bun:test'
import type { Section } from '@/types'
import {
  extractAllText,
  extractPaginatedText,
  extractRefText,
  findInSections,
  getTableData,
  listImages,
  listTables,
  resolveRef,
} from './document-ops'

function makeSections(): Section[] {
  return [
    {
      paragraphs: [
        { ref: 's0.p0', runs: [{ text: 'Hello', charShapeRef: 0 }], paraShapeRef: 0, styleRef: 0 },
        { ref: 's0.p1', runs: [{ text: 'World', charShapeRef: 0 }], paraShapeRef: 0, styleRef: 0 },
        {
          ref: 's0.p2',
          runs: [
            { text: 'Multi', charShapeRef: 0 },
            { text: 'Run', charShapeRef: 1 },
          ],
          paraShapeRef: 0,
          styleRef: 0,
        },
      ],
      tables: [
        {
          ref: 's0.t0',
          rows: [
            {
              cells: [
                {
                  ref: 's0.t0.r0.c0',
                  paragraphs: [
                    {
                      ref: 's0.t0.r0.c0.p0',
                      runs: [{ text: 'Cell A', charShapeRef: 0 }],
                      paraShapeRef: 0,
                      styleRef: 0,
                    },
                  ],
                  colSpan: 1,
                  rowSpan: 1,
                },
                {
                  ref: 's0.t0.r0.c1',
                  paragraphs: [
                    {
                      ref: 's0.t0.r0.c1.p0',
                      runs: [{ text: 'Cell B', charShapeRef: 0 }],
                      paraShapeRef: 0,
                      styleRef: 0,
                    },
                  ],
                  colSpan: 1,
                  rowSpan: 1,
                },
              ],
            },
            {
              cells: [
                {
                  ref: 's0.t0.r1.c0',
                  paragraphs: [
                    {
                      ref: 's0.t0.r1.c0.p0',
                      runs: [{ text: 'Cell C', charShapeRef: 0 }],
                      paraShapeRef: 0,
                      styleRef: 0,
                    },
                  ],
                  colSpan: 1,
                  rowSpan: 1,
                },
                {
                  ref: 's0.t0.r1.c1',
                  paragraphs: [
                    {
                      ref: 's0.t0.r1.c1.p0',
                      runs: [{ text: 'Cell D', charShapeRef: 0 }],
                      paraShapeRef: 0,
                      styleRef: 0,
                    },
                  ],
                  colSpan: 1,
                  rowSpan: 1,
                },
              ],
            },
          ],
        },
      ],
      images: [{ ref: 's0.img0', binDataPath: 'BinData/image0.png', width: 100, height: 50, format: 'png' }],
      textBoxes: [
        {
          ref: 's0.tb0',
          paragraphs: [
            { ref: 's0.tb0.p0', runs: [{ text: 'Box text', charShapeRef: 0 }], paraShapeRef: 0, styleRef: 0 },
          ],
        },
      ],
    },
  ]
}

describe('resolveRef', () => {
  const sections = makeSections()

  test('resolves section ref', () => {
    const result = resolveRef('s0', sections) as { index: number; paragraphs: unknown[] }
    expect(result.index).toBe(0)
    expect(result.paragraphs).toHaveLength(3)
  })

  test('resolves paragraph ref', () => {
    const result = resolveRef('s0.p0', sections) as { ref: string }
    expect(result.ref).toBe('s0.p0')
  })

  test('resolves table ref', () => {
    const result = resolveRef('s0.t0', sections) as { ref: string; rows: unknown[] }
    expect(result.ref).toBe('s0.t0')
    expect(result.rows).toHaveLength(2)
  })

  test('resolves table cell ref', () => {
    const result = resolveRef('s0.t0.r0.c1', sections) as { ref: string }
    expect(result.ref).toBe('s0.t0.r0.c1')
  })

  test('resolves cell paragraph ref', () => {
    const result = resolveRef('s0.t0.r0.c0.p0', sections) as { ref: string }
    expect(result.ref).toBe('s0.t0.r0.c0.p0')
  })

  test('resolves image ref', () => {
    const result = resolveRef('s0.img0', sections) as { ref: string; format: string }
    expect(result.ref).toBe('s0.img0')
    expect(result.format).toBe('png')
  })

  test('resolves textbox ref', () => {
    const result = resolveRef('s0.tb0', sections) as { ref: string; paragraphs: unknown[] }
    expect(result.ref).toBe('s0.tb0')
    expect(result.paragraphs).toHaveLength(1)
  })

  test('resolves textbox paragraph ref', () => {
    const result = resolveRef('s0.tb0.p0', sections) as { ref: string }
    expect(result.ref).toBe('s0.tb0.p0')
  })

  test('throws for missing section', () => {
    expect(() => resolveRef('s9.p0', sections)).toThrow('Section 9 not found')
  })

  test('throws for missing paragraph', () => {
    expect(() => resolveRef('s0.p99', sections)).toThrow('Paragraph')
  })

  test('throws for missing table', () => {
    expect(() => resolveRef('s0.t9', sections)).toThrow('Table')
  })

  test('throws for missing image', () => {
    expect(() => resolveRef('s0.img9', sections)).toThrow('Image')
  })
})

describe('findInSections', () => {
  const sections = makeSections()

  test('finds matching paragraph text', () => {
    const matches = findInSections(sections, 'Hello')
    expect(matches).toHaveLength(1)
    expect(matches[0].ref).toBe('s0.p0')
    expect(matches[0].container).toBe('paragraph')
  })

  test('is case-insensitive', () => {
    const matches = findInSections(sections, 'hello')
    expect(matches).toHaveLength(1)
  })

  test('finds text in table cells', () => {
    const matches = findInSections(sections, 'Cell A')
    expect(matches).toHaveLength(1)
    expect(matches[0].ref).toBe('s0.t0.r0.c0.p0')
    expect(matches[0].container).toBe('table')
  })

  test('finds text in text boxes', () => {
    const matches = findInSections(sections, 'Box text')
    expect(matches).toHaveLength(1)
    expect(matches[0].ref).toBe('s0.tb0.p0')
    expect(matches[0].container).toBe('textBox')
  })

  test('finds multi-run text', () => {
    const matches = findInSections(sections, 'MultiRun')
    expect(matches).toHaveLength(1)
    expect(matches[0].ref).toBe('s0.p2')
  })

  test('returns empty for no matches', () => {
    const matches = findInSections(sections, 'NONEXISTENT')
    expect(matches).toHaveLength(0)
  })
})

describe('extractRefText', () => {
  const sections = makeSections()

  test('extracts paragraph text', () => {
    expect(extractRefText('s0.p0', sections)).toBe('Hello')
  })

  test('extracts multi-run paragraph text', () => {
    expect(extractRefText('s0.p2', sections)).toBe('MultiRun')
  })

  test('extracts table text', () => {
    const text = extractRefText('s0.t0', sections)
    expect(text).toContain('Cell A')
    expect(text).toContain('Cell D')
  })

  test('extracts cell text', () => {
    expect(extractRefText('s0.t0.r0.c0', sections)).toBe('Cell A')
  })

  test('extracts cell paragraph text', () => {
    expect(extractRefText('s0.t0.r0.c0.p0', sections)).toBe('Cell A')
  })

  test('extracts textbox text', () => {
    expect(extractRefText('s0.tb0', sections)).toBe('Box text')
  })

  test('extracts textbox paragraph text', () => {
    expect(extractRefText('s0.tb0.p0', sections)).toBe('Box text')
  })

  test('extracts section text (all containers)', () => {
    const text = extractRefText('s0', sections)
    expect(text).toContain('Hello')
    expect(text).toContain('Cell A')
    expect(text).toContain('Box text')
  })

  test('throws for image ref', () => {
    expect(() => extractRefText('s0.img0', sections)).toThrow('Cannot extract text from image ref')
  })

  test('throws for missing section', () => {
    expect(() => extractRefText('s9.p0', sections)).toThrow('Section 9 not found')
  })
})

describe('extractAllText', () => {
  const sections = makeSections()

  test('extracts all text joined by newlines', () => {
    const text = extractAllText(sections)
    expect(text).toContain('Hello')
    expect(text).toContain('World')
    expect(text).toContain('MultiRun')
    expect(text).toContain('Cell A')
    expect(text).toContain('Cell D')
    expect(text).toContain('Box text')
  })

  test('returns empty string for empty sections', () => {
    const empty: Section[] = [{ paragraphs: [], tables: [], images: [], textBoxes: [] }]
    expect(extractAllText(empty)).toBe('')
  })
})

describe('extractPaginatedText', () => {
  const sections = makeSections()

  test('returns first N paragraphs', () => {
    const result = extractPaginatedText(sections, 0, 2)
    expect(result.text).toBe('Hello\nWorld')
    expect(result.totalParagraphs).toBe(3)
    expect(result.offset).toBe(0)
    expect(result.count).toBe(2)
  })

  test('returns with offset', () => {
    const result = extractPaginatedText(sections, 1, 2)
    expect(result.text).toBe('World\nMultiRun')
    expect(result.offset).toBe(1)
    expect(result.count).toBe(2)
  })

  test('handles offset beyond paragraphs', () => {
    const result = extractPaginatedText(sections, 99, 10)
    expect(result.text).toBe('')
    expect(result.count).toBe(0)
    expect(result.totalParagraphs).toBe(3)
  })

  test('handles limit larger than available', () => {
    const result = extractPaginatedText(sections, 0, 100)
    expect(result.count).toBe(3)
    expect(result.totalParagraphs).toBe(3)
  })
})

describe('getTableData', () => {
  const sections = makeSections()

  test('returns table structure with text', () => {
    const data = getTableData(sections, 's0.t0')
    expect(data.ref).toBe('s0.t0')
    expect(data.rows).toHaveLength(2)
    expect(data.rows[0].cells).toHaveLength(2)
    expect(data.rows[0].cells[0].ref).toBe('s0.t0.r0.c0')
    expect(data.rows[0].cells[0].text).toBe('Cell A')
  })

  test('includes paragraphs in cells', () => {
    const data = getTableData(sections, 's0.t0')
    expect(data.rows[0].cells[0].paragraphs).toHaveLength(1)
  })

  test('throws for non-table ref', () => {
    expect(() => getTableData(sections, 's0.p0')).toThrow('Not a table reference')
  })

  test('throws for missing table', () => {
    expect(() => getTableData(sections, 's0.t9')).toThrow('Table')
  })

  test('throws for missing section', () => {
    expect(() => getTableData(sections, 's9.t0')).toThrow('Section')
  })
})

describe('listTables', () => {
  const sections = makeSections()

  test('returns table summaries', () => {
    const tables = listTables(sections)
    expect(tables).toHaveLength(1)
    expect(tables[0]).toEqual({ ref: 's0.t0', rows: 2, cols: 2 })
  })

  test('returns empty for no tables', () => {
    const empty: Section[] = [{ paragraphs: [], tables: [], images: [], textBoxes: [] }]
    expect(listTables(empty)).toEqual([])
  })
})

describe('listImages', () => {
  const sections = makeSections()

  test('returns all images', () => {
    const images = listImages(sections)
    expect(images).toHaveLength(1)
    expect(images[0].ref).toBe('s0.img0')
    expect(images[0].format).toBe('png')
  })

  test('returns empty for no images', () => {
    const empty: Section[] = [{ paragraphs: [], tables: [], images: [], textBoxes: [] }]
    expect(listImages(empty)).toEqual([])
  })
})
