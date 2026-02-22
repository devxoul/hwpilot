import { loadHwp, loadHwpSectionTexts } from '@/formats/hwp/reader'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { getRefHint } from '@/shared/ref-hints'
import { parseRef } from '@/shared/refs'
import type { Paragraph, Section, Table, TableCell } from '@/types'

type TextOptions = {
  pretty?: boolean
  offset?: number
  limit?: number
}

export async function textCommand(file: string, ref: string | undefined, options: TextOptions): Promise<void> {
  try {
    const format = await detectFormat(file)
    const hasPagination = options.offset !== undefined || options.limit !== undefined

    if (format === 'hwp' && !ref && !hasPagination) {
      const allText = (await loadHwpSectionTexts(file)).join('\n')
      console.log(formatOutput({ text: allText }, options.pretty))
      return
    }

    if (format === 'hwp' && ref) {
      const parsed = parseRef(ref)
      if (parsed.image !== undefined) {
        throw new Error(`Cannot extract text from image ref: ${ref}`)
      }

      if (parsed.paragraph === undefined && parsed.table === undefined && parsed.textBox === undefined) {
        const sectionTexts = await loadHwpSectionTexts(file)
        const sectionText = sectionTexts[parsed.section]
        if (sectionText === undefined) {
          throw new Error(`Section ${parsed.section} not found`)
        }

        console.log(formatOutput({ ref, text: sectionText }, options.pretty))
        return
      }
    }

    const sections = format === 'hwp' ? (await loadHwp(file)).sections : await loadHwpxSections(file)

    if (ref) {
      const text = extractRefText(ref, sections)
      console.log(formatOutput({ ref, text }, options.pretty))
      return
    }

    if (hasPagination) {
      const result = extractPaginatedText(sections, options.offset ?? 0, options.limit ?? Number.POSITIVE_INFINITY)
      console.log(formatOutput(result, options.pretty))
      return
    }

    const allText = extractAllText(sections)
    console.log(formatOutput({ text: allText }, options.pretty))
  } catch (e) {
    const context: Record<string, unknown> = { file }
    if (ref) context.ref = ref
    const hint = ref ? await getRefHint(file, ref).catch(() => undefined) : undefined
    handleError(e, { context, hint })
  }
}

async function loadHwpxSections(file: string): Promise<Section[]> {
  const archive = await loadHwpx(file)
  return parseSections(archive)
}

function paragraphText(p: Paragraph): string {
  return p.runs.map((r) => r.text).join('')
}

function cellText(cell: TableCell): string {
  return cell.paragraphs.map(paragraphText).join('\n')
}

function tableText(table: Table): string {
  return table.rows.flatMap((row) => row.cells.map(cellText)).join('\n')
}

function extractPaginatedText(
  sections: Section[],
  offset: number,
  limit: number,
): { text: string; totalParagraphs: number; offset: number; count: number } {
  const allParagraphs: Paragraph[] = []
  for (const section of sections) {
    allParagraphs.push(...section.paragraphs)
  }

  const sliced = allParagraphs.slice(offset, offset + limit)
  const text = sliced.map(paragraphText).join('\n')

  return {
    text,
    totalParagraphs: allParagraphs.length,
    offset,
    count: sliced.length,
  }
}

function extractAllText(sections: Section[]): string {
  const parts: string[] = []
  for (const section of sections) {
    for (const p of section.paragraphs) {
      parts.push(paragraphText(p))
    }
    for (const t of section.tables) {
      parts.push(tableText(t))
    }
    for (const tb of section.textBoxes) {
      for (const p of tb.paragraphs) {
        parts.push(paragraphText(p))
      }
    }
  }
  return parts.join('\n')
}

function extractRefText(ref: string, sections: Section[]): string {
  const parsed = parseRef(ref)
  const section = sections[parsed.section]

  if (!section) {
    throw new Error(`Section ${parsed.section} not found`)
  }

  if (parsed.image !== undefined) {
    throw new Error(`Cannot extract text from image ref: ${ref}`)
  }

  if (parsed.textBox !== undefined) {
    const textBox = section.textBoxes[parsed.textBox]
    if (!textBox) throw new Error(`TextBox ${ref} not found`)

    if (parsed.textBoxParagraph !== undefined) {
      const para = textBox.paragraphs[parsed.textBoxParagraph]
      if (!para) throw new Error(`Paragraph ${ref} not found`)
      return paragraphText(para)
    }

    return textBox.paragraphs.map(paragraphText).join('\n')
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
        return paragraphText(para)
      }

      return cellText(cell)
    }

    return tableText(table)
  }

  if (parsed.paragraph !== undefined) {
    const para = section.paragraphs[parsed.paragraph]
    if (!para) throw new Error(`Paragraph ${ref} not found`)
    return paragraphText(para)
  }

  const parts: string[] = []
  for (const p of section.paragraphs) {
    parts.push(paragraphText(p))
  }
  for (const t of section.tables) {
    parts.push(tableText(t))
  }
  for (const tb of section.textBoxes) {
    for (const p of tb.paragraphs) {
      parts.push(paragraphText(p))
    }
  }
  return parts.join('\n')
}
