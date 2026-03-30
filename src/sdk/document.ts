import { detectFormat } from '@/sdk/format-detector'
import { loadHwp } from '@/sdk/formats/hwp/reader'
import { editHwp } from '@/sdk/formats/hwp/writer'
import { parseHeader } from '@/sdk/formats/hwpx/header-parser'
import { loadHwpx } from '@/sdk/formats/hwpx/loader'
import { editHwpx } from '@/sdk/formats/hwpx/writer'
import { parseSections } from '@/sdk/formats/hwpx/section-parser'
import {
  extractAllText,
  extractPaginatedText,
  extractRefText,
  findInSections,
  getTableData,
  listImages,
  listTables,
  resolveRef,
} from '@/sdk/document-ops'
import type { EditOperation, FormatOptions } from '@/sdk/edit-types'
import type { HwpDocument } from '@/sdk/types'

export class Document {
  private _doc: HwpDocument
  private _bytes: Uint8Array
  private readonly _format: 'hwp' | 'hwpx'

  constructor(doc: HwpDocument, bytes: Uint8Array) {
    this._doc = doc
    this._bytes = bytes
    this._format = doc.format
  }

  get format(): 'hwp' | 'hwpx' {
    return this._format
  }

  read(refOrOptions?: string | { offset?: number; limit?: number }): unknown {
    if (typeof refOrOptions === 'string') {
      return resolveRef(refOrOptions, this._doc.sections)
    }

    const offset = refOrOptions?.offset ?? 0
    const limit = refOrOptions?.limit ?? Number.POSITIVE_INFINITY
    const hasPagination = refOrOptions?.offset !== undefined || refOrOptions?.limit !== undefined

    return {
      format: this._doc.format,
      sections: this._doc.sections.map((section, index) => {
        const paragraphs = hasPagination ? section.paragraphs.slice(offset, offset + limit) : section.paragraphs
        return {
          index,
          ...(hasPagination && {
            totalParagraphs: section.paragraphs.length,
            totalTables: section.tables.length,
            totalImages: section.images.length,
            totalTextBoxes: section.textBoxes.length,
          }),
          paragraphs,
          tables: section.tables,
          images: section.images,
          textBoxes: section.textBoxes,
        }
      }),
      header: this._doc.header,
    }
  }

  text(refOrOptions?: string | { offset?: number; limit?: number }): string {
    if (typeof refOrOptions === 'string') {
      return extractRefText(refOrOptions, this._doc.sections)
    }

    if (refOrOptions?.offset !== undefined || refOrOptions?.limit !== undefined) {
      const offset = refOrOptions?.offset ?? 0
      const limit = refOrOptions?.limit ?? Number.POSITIVE_INFINITY
      return extractPaginatedText(this._doc.sections, offset, limit).text
    }

    return extractAllText(this._doc.sections)
  }

  find(query: string): unknown[] {
    return findInSections(this._doc.sections, query)
  }

  tableRead(ref: string): unknown {
    return getTableData(this._doc.sections, ref)
  }

  tableList(): unknown[] {
    return listTables(this._doc.sections)
  }

  imageList(): unknown[] {
    return listImages(this._doc.sections)
  }

  async editText(ref: string, text: string): Promise<void> {
    await this._applyOp({ type: 'setText', ref, text })
  }

  async editFormat(ref: string, format: FormatOptions & { start?: number; end?: number }): Promise<void> {
    const { start, end, ...fmt } = format
    await this._applyOp({ type: 'setFormat', ref, format: fmt, start, end })
  }

  async tableEdit(ref: string, text: string): Promise<void> {
    await this._applyOp({ type: 'setTableCell', ref, text })
  }

  async addParagraph(
    ref: string,
    text: string,
    options?: { position?: 'before' | 'after' | 'end'; bold?: boolean; italic?: boolean; underline?: boolean; fontName?: string; fontSize?: number; color?: string; heading?: number; style?: string | number },
  ): Promise<void> {
    const position = options?.position ?? 'end'
    const format: FormatOptions | undefined =
      options?.bold !== undefined ||
      options?.italic !== undefined ||
      options?.underline !== undefined ||
      options?.fontName !== undefined ||
      options?.fontSize !== undefined ||
      options?.color !== undefined
        ? {
            bold: options?.bold,
            italic: options?.italic,
            underline: options?.underline,
            fontName: options?.fontName,
            fontSize: options?.fontSize,
            color: options?.color,
          }
        : undefined
    await this._applyOp({
      type: 'addParagraph',
      ref,
      text,
      position,
      format,
      heading: options?.heading,
      style: options?.style,
    })
  }

  async addTable(
    ref: string,
    rows: number,
    cols: number,
    options?: { data?: string[][]; position?: 'before' | 'after' | 'end' },
  ): Promise<void> {
    await this._applyOp({
      type: 'addTable',
      ref,
      rows,
      cols,
      data: options?.data,
      position: options?.position ?? 'end',
    })
  }

  async export(): Promise<Uint8Array> {
    return this._bytes
  }

  private async _applyOp(op: EditOperation): Promise<void> {
    if (this._format === 'hwp') {
      const newBytes = await editHwp(this._bytes, [op])
      const newDoc = await loadHwp(newBytes)
      this._bytes = newBytes
      this._doc = newDoc
    } else {
      const newBytes = await editHwpx(this._bytes, [op])
      const archive = await loadHwpx(newBytes)
      const header = parseHeader(await archive.getHeaderXml())
      const sections = await parseSections(archive)
      this._bytes = newBytes
      this._doc = { format: 'hwpx', sections, header }
    }
  }
}

export async function documentFromBytes(bytes: Uint8Array): Promise<Document> {
  const format = detectFormat(bytes)
  if (format === 'hwp') {
    const doc = await loadHwp(bytes)
    return new Document(doc, bytes)
  }
  const archive = await loadHwpx(bytes)
  const header = parseHeader(await archive.getHeaderXml())
  const sections = await parseSections(archive)
  const doc = { format: 'hwpx' as const, sections, header }
  return new Document(doc, bytes)
}
