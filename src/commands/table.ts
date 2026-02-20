import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { editHwpx } from '@/formats/hwpx/writer'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { parseRef, validateRef } from '@/shared/refs'

export async function tableReadCommand(file: string, ref: string, options: { pretty?: boolean }): Promise<void> {
  try {
    const format = await detectFormat(file)

    if (format === 'hwp') {
      throw new Error('HWP 5.0 read not yet supported')
    }

    if (!validateRef(ref)) {
      throw new Error(`Invalid reference: ${ref}`)
    }

    const parsed = parseRef(ref)
    if (parsed.table === undefined) {
      throw new Error(`Not a table reference: ${ref}`)
    }

    const archive = await loadHwpx(file)
    const sections = await parseSections(archive)
    const section = sections[parsed.section]

    if (!section) {
      throw new Error(`Section ${parsed.section} not found`)
    }

    const table = section.tables[parsed.table]
    if (!table) {
      throw new Error(`Table ${ref} not found`)
    }

    const output = {
      ref: table.ref,
      rows: table.rows.map((row) => ({
        cells: row.cells.map((cell) => ({
          ref: cell.ref,
          text: cell.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join(''),
          paragraphs: cell.paragraphs,
        })),
      })),
    }

    console.log(formatOutput(output, options.pretty))
  } catch (e) {
    handleError(e)
  }
}

export async function tableEditCommand(
  file: string,
  ref: string,
  text: string,
  options: { pretty?: boolean },
): Promise<void> {
  try {
    const format = await detectFormat(file)

    if (format === 'hwp') {
      throw new Error('HWP 5.0 write not supported')
    }

    if (!validateRef(ref)) {
      throw new Error(`Invalid reference: ${ref}`)
    }

    const parsed = parseRef(ref)
    if (parsed.table === undefined || parsed.row === undefined || parsed.cell === undefined) {
      throw new Error(`Not a cell reference: ${ref}`)
    }

    await editHwpx(file, [{ type: 'setTableCell', ref, text }])

    console.log(formatOutput({ ref, text, success: true }, options.pretty))
  } catch (e) {
    handleError(e)
  }
}
