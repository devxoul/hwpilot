import { describe, expect, it } from 'bun:test'
import type {
  CharShape,
  HwpDocument,
  Paragraph,
  ParaShape,
  Section,
  Style,
  Table,
} from '@/types'
import { hwpToMarkdown } from './to-markdown'

function makeDoc(
  sections: Section[],
  charShapes: CharShape[] = [],
  paraShapes: ParaShape[] = [],
  styles: Style[] = []
): HwpDocument {
  return {
    format: 'hwpx',
    sections,
    header: { fonts: [], charShapes, paraShapes, styles },
  }
}

function makePara(
  text: string,
  charShapeRef = 0,
  paraShapeRef = 0,
  styleRef = 0
): Paragraph {
  return {
    ref: 's0.p0',
    runs: text ? [{ text, charShapeRef }] : [],
    paraShapeRef,
    styleRef,
  }
}

function makeSection(paragraphs: Paragraph[] = []): Section {
  return {
    paragraphs,
    tables: [],
    images: [],
    textBoxes: [],
  }
}

describe('hwpToMarkdown', () => {
  it('converts plain text paragraph', () => {
    const doc = makeDoc([makeSection([makePara('Hello world')])])

    expect(hwpToMarkdown(doc)).toBe('Hello world')
  })

  it('separates multiple paragraphs with blank lines', () => {
    const doc = makeDoc([
      makeSection([makePara('First paragraph'), makePara('Second paragraph')]),
    ])

    expect(hwpToMarkdown(doc)).toBe('First paragraph\n\nSecond paragraph')
  })

  it('keeps empty paragraph as a blank line', () => {
    const doc = makeDoc([
      makeSection([makePara('Before'), makePara(''), makePara('After')]),
    ])

    expect(hwpToMarkdown(doc)).toBe('Before\n\n\n\nAfter')
  })

  it('applies bold formatting', () => {
    const charShapes: CharShape[] = [
      {
        id: 0,
        fontRef: 0,
        fontSize: 10,
        bold: true,
        italic: false,
        underline: false,
        color: '#000000',
      },
    ]
    const doc = makeDoc([makeSection([makePara('Bold text')])], charShapes)

    expect(hwpToMarkdown(doc)).toBe('**Bold text**')
  })

  it('applies italic formatting', () => {
    const charShapes: CharShape[] = [
      {
        id: 0,
        fontRef: 0,
        fontSize: 10,
        bold: false,
        italic: true,
        underline: false,
        color: '#000000',
      },
    ]
    const doc = makeDoc([makeSection([makePara('Italic text')])], charShapes)

    expect(hwpToMarkdown(doc)).toBe('*Italic text*')
  })

  it('applies bold and italic formatting together', () => {
    const charShapes: CharShape[] = [
      {
        id: 0,
        fontRef: 0,
        fontSize: 10,
        bold: true,
        italic: true,
        underline: false,
        color: '#000000',
      },
    ]
    const doc = makeDoc([makeSection([makePara('Strong emphasis')])], charShapes)

    expect(hwpToMarkdown(doc)).toBe('***Strong emphasis***')
  })

  it('converts mixed runs with inline formatting', () => {
    const section = makeSection([
      {
        ref: 's0.p0',
        paraShapeRef: 0,
        styleRef: 0,
        runs: [
          { text: 'plain ', charShapeRef: 0 },
          { text: 'bold', charShapeRef: 1 },
          { text: ' and ', charShapeRef: 0 },
          { text: 'italic', charShapeRef: 2 },
          { text: ' plus ', charShapeRef: 0 },
          { text: 'both', charShapeRef: 3 },
        ],
      },
    ])
    const charShapes: CharShape[] = [
      {
        id: 0,
        fontRef: 0,
        fontSize: 10,
        bold: false,
        italic: false,
        underline: false,
        color: '#000000',
      },
      {
        id: 1,
        fontRef: 0,
        fontSize: 10,
        bold: true,
        italic: false,
        underline: false,
        color: '#000000',
      },
      {
        id: 2,
        fontRef: 0,
        fontSize: 10,
        bold: false,
        italic: true,
        underline: false,
        color: '#000000',
      },
      {
        id: 3,
        fontRef: 0,
        fontSize: 10,
        bold: true,
        italic: true,
        underline: false,
        color: '#000000',
      },
    ]
    const doc = makeDoc([section], charShapes)

    expect(hwpToMarkdown(doc)).toBe(
      'plain **bold** and *italic* plus ***both***'
    )
  })

  it('drops underline, color, and font size from markdown output', () => {
    const charShapes: CharShape[] = [
      {
        id: 0,
        fontRef: 0,
        fontSize: 22,
        bold: false,
        italic: false,
        underline: true,
        color: '#ff0000',
      },
    ]
    const doc = makeDoc([makeSection([makePara('Styled text')])], charShapes)

    expect(hwpToMarkdown(doc)).toBe('Styled text')
  })

  it('renders heading level 1 with # prefix', () => {
    const para = makePara('Title', 0, 0, 1)
    const styles: Style[] = [
      { id: 1, name: 'Heading 1', charShapeRef: 0, paraShapeRef: 0 },
    ]
    const doc = makeDoc([makeSection([para])], [], [], styles)

    expect(hwpToMarkdown(doc)).toBe('# Title')
  })

  it('renders heading level 2 with ## prefix', () => {
    const para = makePara('Subtitle', 0, 0, 1)
    const styles: Style[] = [
      { id: 1, name: 'Heading 2', charShapeRef: 0, paraShapeRef: 0 },
    ]
    const doc = makeDoc([makeSection([para])], [], [], styles)

    expect(hwpToMarkdown(doc)).toBe('## Subtitle')
  })

  it('detects heading through style name "개요 1"', () => {
    const para = makePara('Korean heading', 0, 0, 7)
    const styles: Style[] = [
      { id: 7, name: '개요 1', charShapeRef: 0, paraShapeRef: 0 },
    ]
    const doc = makeDoc([makeSection([para])], [], [], styles)

    expect(hwpToMarkdown(doc)).toBe('# Korean heading')
  })

  it('detects heading through paraShape.headingLevel', () => {
    const para = makePara('Shape heading', 0, 5, 1)
    const paraShapes: ParaShape[] = [{ id: 5, align: 'left', headingLevel: 3 }]
    const styles: Style[] = [
      { id: 1, name: 'Normal', charShapeRef: 0, paraShapeRef: 5 },
    ]
    const doc = makeDoc([makeSection([para])], [], paraShapes, styles)

    expect(hwpToMarkdown(doc)).toBe('### Shape heading')
  })

  it('renders 2x2 table in GFM format', () => {
    const table: Table = {
      ref: 's0.t0',
      rows: [
        {
          cells: [
            {
              ref: 's0.t0.r0.c0',
              paragraphs: [makePara('A')],
              colSpan: 1,
              rowSpan: 1,
            },
            {
              ref: 's0.t0.r0.c1',
              paragraphs: [makePara('B')],
              colSpan: 1,
              rowSpan: 1,
            },
          ],
        },
        {
          cells: [
            {
              ref: 's0.t0.r1.c0',
              paragraphs: [makePara('1')],
              colSpan: 1,
              rowSpan: 1,
            },
            {
              ref: 's0.t0.r1.c1',
              paragraphs: [makePara('2')],
              colSpan: 1,
              rowSpan: 1,
            },
          ],
        },
      ],
    }
    const doc = makeDoc([{ ...makeSection(), tables: [table] }])

    expect(hwpToMarkdown(doc)).toBe('| A | B |\n|---|---|\n| 1 | 2 |')
  })

  it('uses correct header separator count based on columns', () => {
    const table: Table = {
      ref: 's0.t0',
      rows: [
        {
          cells: [
            {
              ref: 's0.t0.r0.c0',
              paragraphs: [makePara('A')],
              colSpan: 1,
              rowSpan: 1,
            },
            {
              ref: 's0.t0.r0.c1',
              paragraphs: [makePara('B')],
              colSpan: 1,
              rowSpan: 1,
            },
            {
              ref: 's0.t0.r0.c2',
              paragraphs: [makePara('C')],
              colSpan: 1,
              rowSpan: 1,
            },
          ],
        },
      ],
    }
    const doc = makeDoc([{ ...makeSection(), tables: [table] }])

    expect(hwpToMarkdown(doc)).toBe('| A | B | C |\n|---|---|---|')
  })

  it('joins multi-paragraph table cell content with spaces', () => {
    const table: Table = {
      ref: 's0.t0',
      rows: [
        {
          cells: [
            {
              ref: 's0.t0.r0.c0',
              paragraphs: [makePara('Header')],
              colSpan: 1,
              rowSpan: 1,
            },
          ],
        },
        {
          cells: [
            {
              ref: 's0.t0.r1.c0',
              paragraphs: [makePara('Hello'), makePara('World')],
              colSpan: 1,
              rowSpan: 1,
            },
          ],
        },
      ],
    }
    const doc = makeDoc([{ ...makeSection(), tables: [table] }])

    expect(hwpToMarkdown(doc)).toBe('| Header |\n|---|\n| Hello World |')
  })

  it('renders image as markdown image reference', () => {
    const doc = makeDoc([
      {
        ...makeSection(),
        images: [
          {
            ref: 's0.i0',
            binDataPath: 'BinData/image1.png',
            width: 640,
            height: 480,
            format: 'png',
          },
        ],
      },
    ])

    expect(hwpToMarkdown(doc)).toBe('![](BinData/image1.png)')
  })

  it('renders text box paragraphs as regular paragraphs', () => {
    const doc = makeDoc([
      {
        ...makeSection(),
        textBoxes: [
          {
            ref: 's0.tb0',
            paragraphs: [makePara('In text box'), makePara('Second line')],
          },
        ],
      },
    ])

    expect(hwpToMarkdown(doc)).toBe('In text box\n\nSecond line')
  })

  it('separates two sections with thematic break', () => {
    const doc = makeDoc([
      makeSection([makePara('Section 1')]),
      makeSection([makePara('Section 2')]),
    ])

    expect(hwpToMarkdown(doc)).toBe('Section 1\n\n---\n\nSection 2')
  })

  it('uses two thematic breaks for three sections', () => {
    const doc = makeDoc([
      makeSection([makePara('One')]),
      makeSection([makePara('Two')]),
      makeSection([makePara('Three')]),
    ])

    expect(hwpToMarkdown(doc)).toBe('One\n\n---\n\nTwo\n\n---\n\nThree')
  })
})
