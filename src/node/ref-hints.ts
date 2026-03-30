import { readFile } from 'node:fs/promises'

import { detectFormat } from '@/sdk/format-detector'
import { loadHwp } from '@/sdk/formats/hwp/reader'
import { loadHwpx } from '@/sdk/formats/hwpx/loader'
import { parseSections } from '@/sdk/formats/hwpx/section-parser'
import { parseRef, validateRef } from '@/sdk/refs'
import type { Section } from '@/sdk/types'

export async function getRefHint(file: string, ref: string): Promise<string | undefined> {
  if (!validateRef(ref)) {
    return 'Valid ref format: s<N>.p<N>, s<N>.t<N>.r<N>.c<N>'
  }

  const buffer = await readFile(file)
  const bytes = new Uint8Array(buffer)
  const format = detectFormat(bytes)
  const sections = format === 'hwp' ? (await loadHwp(bytes)).sections : await parseSections(await loadHwpx(bytes))

  return computeHint(sections, ref)
}

function computeHint(sections: Section[], ref: string): string | undefined {
  const parsed = parseRef(ref)
  const section = sections[parsed.section]

  if (!section) {
    if (sections.length === 0) return 'Document has no sections'
    return `Valid sections: s0 through s${sections.length - 1}`
  }

  if (parsed.table !== undefined) {
    const table = section.tables[parsed.table]
    if (!table) {
      if (section.tables.length === 0) return `Section ${parsed.section} has no tables`
      return `Valid table refs: s${parsed.section}.t0 through s${parsed.section}.t${section.tables.length - 1}`
    }

    if (parsed.row !== undefined) {
      const row = table.rows[parsed.row]
      if (!row) {
        if (table.rows.length === 0) return `Table s${parsed.section}.t${parsed.table} has no rows`
        return `Valid row refs: s${parsed.section}.t${parsed.table}.r0 through s${parsed.section}.t${parsed.table}.r${table.rows.length - 1}`
      }

      if (parsed.cell !== undefined) {
        const cell = row.cells[parsed.cell]
        if (!cell) {
          if (row.cells.length === 0) return `Row s${parsed.section}.t${parsed.table}.r${parsed.row} has no cells`
          return `Valid cell refs: s${parsed.section}.t${parsed.table}.r${parsed.row}.c0 through s${parsed.section}.t${parsed.table}.r${parsed.row}.c${row.cells.length - 1}`
        }
      }
    }

    return undefined
  }

  if (parsed.textBox !== undefined) {
    const textBox = section.textBoxes[parsed.textBox]
    if (!textBox) {
      if (section.textBoxes.length === 0) return `Section ${parsed.section} has no text boxes`
      return `Valid text box refs: s${parsed.section}.tb0 through s${parsed.section}.tb${section.textBoxes.length - 1}`
    }

    if (parsed.textBoxParagraph !== undefined) {
      const para = textBox.paragraphs[parsed.textBoxParagraph]
      if (!para) {
        if (textBox.paragraphs.length === 0) return `Text box s${parsed.section}.tb${parsed.textBox} has no paragraphs`
        return `Valid text box paragraph refs: s${parsed.section}.tb${parsed.textBox}.p0 through s${parsed.section}.tb${parsed.textBox}.p${textBox.paragraphs.length - 1}`
      }
    }

    return undefined
  }

  if (parsed.paragraph !== undefined) {
    const para = section.paragraphs[parsed.paragraph]
    if (!para) {
      if (section.paragraphs.length === 0) return `Section ${parsed.section} has no paragraphs`
      return `Valid paragraph refs: s${parsed.section}.p0 through s${parsed.section}.p${section.paragraphs.length - 1}`
    }
  }

  return undefined
}
