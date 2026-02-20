export type HwpDocument = {
  format: 'hwpx' | 'hwp'
  sections: Section[]
  header: DocumentHeader
}

export type DocumentHeader = {
  fonts: FontFace[]
  charShapes: CharShape[]
  paraShapes: ParaShape[]
  styles: Style[]
}

export type FontFace = {
  id: number
  name: string
  family?: string
}

export type CharShape = {
  id: number
  fontRef: number
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  color: string
}

export type ParaShape = {
  id: number
  align: 'left' | 'center' | 'right' | 'justify'
}

export type Style = {
  id: number
  name: string
  charShapeRef: number
  paraShapeRef: number
}

export type Section = {
  paragraphs: Paragraph[]
  tables: Table[]
  images: Image[]
}

export type Paragraph = {
  ref: string
  runs: Run[]
  paraShapeRef: number
  styleRef: number
}

export type Run = {
  text: string
  charShapeRef: number
}

export type Table = {
  ref: string
  rows: TableRow[]
}

export type TableRow = {
  cells: TableCell[]
}

export type TableCell = {
  ref: string
  paragraphs: Paragraph[]
  colSpan: number
  rowSpan: number
}

export type Image = {
  ref: string
  binDataPath: string
  width: number
  height: number
  format: string
}
