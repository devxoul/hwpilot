export { Document, documentFromBytes } from './document'
export type { HwpDocument, Section, Paragraph, Run, Table, TableRow, TableCell, Image, TextBox, DocumentHeader, FontFace, CharShape, ParaShape, Style } from './types'
export type { EditOperation, FormatOptions } from './edit-types'
export { detectFormat } from './format-detector'
export type { HwpFormat } from './format-detector'
export { loadHwp, loadHwpSectionTexts, extractParaText } from './formats/hwp/reader'
export { editHwp } from './formats/hwp/writer'
export { createHwp } from './formats/hwp/creator'
export { validateHwp, validateHwpBuffer } from './formats/hwp/validator'
export { loadHwpx } from './formats/hwpx/loader'
export { editHwpx } from './formats/hwpx/writer'
export { parseSections, parseSection } from './formats/hwpx/section-parser'
export { parseHeader } from './formats/hwpx/header-parser'
export { markdownToHwp } from './markdown/to-hwp'
export { hwpToMarkdown } from './markdown/to-markdown'

export async function loadDocument(buffer: Uint8Array): Promise<import('./document').Document> {
  const { documentFromBytes } = await import('./document')
  return documentFromBytes(buffer)
}
