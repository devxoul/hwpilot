import { loadHwp } from '@/formats/hwp/reader'
import { parseHeader } from '@/formats/hwpx/header-parser'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { parseRef } from '@/shared/refs'
import type { Section } from '@/types'

type ReadOptions = {
  pretty?: boolean
  offset?: number
  limit?: number
}

export async function readCommand(file: string, ref: string | undefined, options: ReadOptions): Promise<void> {
  try {
    const format = await detectFormat(file)
    const doc = format === 'hwp' ? await loadHwp(file) : await loadHwpxDocument(file)

    if (ref) {
      const result = resolveRef(ref, doc.sections)
      console.log(formatOutput(result, options.pretty))
      return
    }

    const hasPagination = options.offset !== undefined || options.limit !== undefined
    const offset = options.offset ?? 0
    const limit = options.limit ?? Number.POSITIVE_INFINITY

    const output = {
      format: doc.format,
      sections: doc.sections.map((section, index) => {
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
      header: doc.header,
    }

    console.log(formatOutput(output, options.pretty))
  } catch (e) {
    handleError(e)
  }
}

async function loadHwpxDocument(file: string) {
  const archive = await loadHwpx(file)
  const header = parseHeader(await archive.getHeaderXml())
  const sections = await parseSections(archive)

  return {
    format: 'hwpx' as const,
    sections,
    header,
  }
}

function resolveRef(ref: string, sections: Section[]): unknown {
  const parsed = parseRef(ref)
  const section = sections[parsed.section]

  if (!section) {
    throw new Error(`Section ${parsed.section} not found`)
  }

  if (parsed.image !== undefined) {
    const image = section.images[parsed.image]
    if (!image) throw new Error(`Image ${ref} not found`)
    return image
  }

  if (parsed.textBox !== undefined) {
    const textBox = section.textBoxes[parsed.textBox]
    if (!textBox) throw new Error(`TextBox ${ref} not found`)

    if (parsed.textBoxParagraph !== undefined) {
      const para = textBox.paragraphs[parsed.textBoxParagraph]
      if (!para) throw new Error(`Paragraph ${ref} not found`)
      return para
    }

    return textBox
  }

  if (parsed.table !== undefined) {
    const table = section.tables[parsed.table]
    if (!table) throw new Error(`Table ${ref} not found`)

    if (parsed.row !== undefined && parsed.cell !== undefined) {
      const row = table.rows[parsed.row]
      if (!row) throw new Error(`Row ${ref} not found`)
      const cell = row.cells[parsed.cell]
      if (!cell) throw new Error(`Cell ${ref} not found`)

      if (parsed.cellParagraph !== undefined) {
        const para = cell.paragraphs[parsed.cellParagraph]
        if (!para) throw new Error(`Paragraph ${ref} not found`)
        return para
      }

      return cell
    }

    return table
  }

  if (parsed.paragraph !== undefined) {
    const para = section.paragraphs[parsed.paragraph]
    if (!para) throw new Error(`Paragraph ${ref} not found`)
    return para
  }

  return {
    index: parsed.section,
    paragraphs: section.paragraphs,
    tables: section.tables,
    images: section.images,
    textBoxes: section.textBoxes,
  }
}
