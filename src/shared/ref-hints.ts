import { loadHwp } from '@/formats/hwp/reader'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { detectFormat } from '@/shared/format-detector'
import { parseRef, validateRef } from '@/shared/refs'
import type { Section } from '@/types'

export async function getRefHint(file: string, ref: string): Promise<string | undefined> {
  if (!validateRef(ref)) {
    return 'Valid ref format: s<N>.p<N>, s<N>.t<N>.r<N>.c<N>'
  }

  const format = await detectFormat(file)
  const sections = format === 'hwp' ? (await loadHwp(file)).sections : await parseSections(await loadHwpx(file))

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
        return `Valid row refs: s${parsed.section}.t${parsed.table}.r0 through s${parsed.section}.t${parsed.table}.r${table.rows.length - 1}`
      }

      if (parsed.cell !== undefined) {
        const cell = row.cells[parsed.cell]
        if (!cell) {
          return `Valid cell refs: s${parsed.section}.t${parsed.table}.r${parsed.row}.c0 through s${parsed.section}.t${parsed.table}.r${parsed.row}.c${row.cells.length - 1}`
        }
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
