import { describe, it } from 'bun:test'
import type { DocumentHeader, HwpDocument, Image, ParaShape, Section, Style, Table, TextBox } from './types'

describe('types', () => {
  it('HwpDocument type is correct', () => {
    const doc: HwpDocument = {
      format: 'hwpx',
      sections: [],
      header: {
        fonts: [],
        charShapes: [],
        paraShapes: [],
        styles: [],
      },
    }
    // Type-level test: if this compiles, it passes
    void doc
  })

  it('Section with paragraphs and tables', () => {
    const section: Section = {
      paragraphs: [
        {
          ref: 's0.p0',
          runs: [{ text: 'hello', charShapeRef: 0 }],
          paraShapeRef: 0,
          styleRef: 0,
        },
      ],
      tables: [],
      images: [],
      textBoxes: [],
    }
    void section
  })

  it('Table with cells', () => {
    const table: Table = {
      ref: 's0.t0',
      rows: [
        {
          cells: [
            {
              ref: 's0.t0.r0.c0',
              paragraphs: [],
              colSpan: 1,
              rowSpan: 1,
            },
          ],
        },
      ],
    }
    void table
  })

  it('Image type is correct', () => {
    const img: Image = {
      ref: 's0.img0',
      binDataPath: 'BinData/image0.png',
      width: 200,
      height: 150,
      format: 'png',
    }
    void img
  })

  it('DocumentHeader contains all shape types', () => {
    const header: DocumentHeader = {
      fonts: [{ id: 0, name: '맑은 고딕', family: 'sans-serif' }],
      charShapes: [{ id: 0, fontRef: 0, fontSize: 10, bold: false, italic: false, underline: false, color: '#000000' }],
      paraShapes: [{ id: 0, align: 'left' }],
      styles: [{ id: 0, name: 'Normal', charShapeRef: 0, paraShapeRef: 0 }],
    }
    void header
  })

  it('ParaShape supports optional headingLevel', () => {
    const body: ParaShape = { id: 0, align: 'left' }
    const heading: ParaShape = { id: 1, align: 'left', headingLevel: 1 }
    void body
    void heading
  })

  it('Style supports optional type field', () => {
    const body: Style = { id: 0, name: 'Normal', charShapeRef: 0, paraShapeRef: 0 }
    const heading: Style = { id: 1, name: '개요 1', charShapeRef: 1, paraShapeRef: 1, type: 'PARA' }
    void body
    void heading
  })

  it('TextBox type is correct', () => {
    const textBox: TextBox = {
      ref: 's0.tb0',
      paragraphs: [
        {
          ref: 's0.tb0.p0',
          runs: [{ text: 'text in box', charShapeRef: 0 }],
          paraShapeRef: 0,
          styleRef: 0,
        },
      ],
    }
    void textBox
  })
})
