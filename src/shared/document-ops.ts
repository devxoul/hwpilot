import { parseRef } from '@/shared/refs'
import type { Image, Paragraph, Section, Table, TableCell } from '@/types'

type Match = {
  ref: string
  text: string
  container: 'paragraph' | 'table' | 'textBox'
}

export function resolveRef(ref: string, sections: Section[]): unknown {
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

export function findInSections(sections: Section[], query: string): Match[] {
  const matches: Match[] = []
  const lowerQuery = query.toLowerCase()

  for (const section of sections) {
    for (const para of section.paragraphs) {
      const text = paragraphText(para)
      if (text.toLowerCase().includes(lowerQuery)) {
        matches.push({ ref: para.ref, text, container: 'paragraph' })
      }
    }

    for (const table of section.tables) {
      for (const row of table.rows) {
        for (const cell of row.cells) {
          for (const para of cell.paragraphs) {
            const text = paragraphText(para)
            if (text.toLowerCase().includes(lowerQuery)) {
              matches.push({ ref: para.ref, text, container: 'table' })
            }
          }
        }
      }
    }

    for (const textBox of section.textBoxes) {
      for (const para of textBox.paragraphs) {
        const text = paragraphText(para)
        if (text.toLowerCase().includes(lowerQuery)) {
          matches.push({ ref: para.ref, text, container: 'textBox' })
        }
      }
    }
  }

  return matches
}

export function extractRefText(ref: string, sections: Section[]): string {
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

export function extractAllText(sections: Section[]): string {
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

export function extractPaginatedText(
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

export function getTableData(
  sections: Section[],
  ref: string,
): { ref: string; rows: { cells: { ref: string; text: string; paragraphs: unknown[] }[] }[] } {
  const parsed = parseRef(ref)
  if (parsed.table === undefined) {
    throw new Error(`Not a table reference: ${ref}`)
  }

  const section = sections[parsed.section]
  if (!section) {
    throw new Error(`Section ${parsed.section} not found`)
  }

  const table = section.tables[parsed.table]
  if (!table) {
    throw new Error(`Table ${ref} not found`)
  }

  return {
    ref: table.ref,
    rows: table.rows.map((row) => ({
      cells: row.cells.map((cell) => ({
        ref: cell.ref,
        text: cell.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join(''),
        paragraphs: cell.paragraphs,
      })),
    })),
  }
}

export function listTables(sections: Section[]): { ref: string; rows: number; cols: number }[] {
  const tables: { ref: string; rows: number; cols: number }[] = []

  for (const [si, section] of sections.entries()) {
    for (const [ti, table] of section.tables.entries()) {
      tables.push({
        ref: `s${si}.t${ti}`,
        rows: table.rows.length,
        cols: table.rows[0]?.cells.length ?? 0,
      })
    }
  }

  return tables
}

export function listImages(sections: Section[]): Image[] {
  return sections.flatMap((section) => section.images)
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
