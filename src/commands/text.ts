import { loadHwp } from '@/formats/hwp/reader'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { parseRef } from '@/shared/refs'
import type { Paragraph, Section, Table, TableCell } from '@/types'

export async function textCommand(file: string, ref: string | undefined, options: { pretty?: boolean }): Promise<void> {
  try {
    const format = await detectFormat(file)
    const sections = format === 'hwp' ? (await loadHwp(file)).sections : await loadHwpxSections(file)

    if (ref) {
      const text = extractRefText(ref, sections)
      console.log(formatOutput({ ref, text }, options.pretty))
      return
    }

    const allText = extractAllText(sections)
    console.log(formatOutput({ text: allText }, options.pretty))
  } catch (e) {
    handleError(e)
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

function extractAllText(sections: Section[]): string {
  const parts: string[] = []
  for (const section of sections) {
    for (const p of section.paragraphs) {
      parts.push(paragraphText(p))
    }
    for (const t of section.tables) {
      parts.push(tableText(t))
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
  return parts.join('\n')
}
