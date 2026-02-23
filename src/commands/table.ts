import { loadHwp } from '@/formats/hwp/reader'
import { editHwp } from '@/formats/hwp/writer'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { editHwpx } from '@/formats/hwpx/writer'
import { getTableData, listTables } from '@/shared/document-ops'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { getRefHint } from '@/shared/ref-hints'
import { parseRef, validateRef } from '@/shared/refs'
import type { Section } from '@/types'

export async function tableReadCommand(file: string, ref: string, options: { pretty?: boolean }): Promise<void> {
  try {
    const format = await detectFormat(file)

    if (!validateRef(ref)) {
      throw new Error(`Invalid reference: ${ref}`)
    }

    const sections = format === 'hwp' ? (await loadHwp(file)).sections : await loadHwpxSections(file)
    const output = getTableData(sections, ref)

    console.log(formatOutput(output, options.pretty))
  } catch (e) {
    const hint = await getRefHint(file, ref).catch(() => undefined)
    handleError(e, { context: { ref, file }, hint })
  }
}

export async function tableListCommand(file: string, options: { pretty?: boolean }): Promise<void> {
  try {
    const format = await detectFormat(file)
    const sections = format === 'hwp' ? (await loadHwp(file)).sections : await loadHwpxSections(file)

    const tables = listTables(sections)

    console.log(formatOutput(tables, options.pretty))
  } catch (e) {
    handleError(e, { context: { file } })
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

    if (!validateRef(ref)) {
      throw new Error(`Invalid reference: ${ref}`)
    }

    const parsed = parseRef(ref)
    if (parsed.table === undefined || parsed.row === undefined || parsed.cell === undefined) {
      throw new Error(`Not a cell reference: ${ref}`)
    }

    if (format === 'hwp') {
      await editHwp(file, [{ type: 'setTableCell', ref, text }])
    } else {
      await editHwpx(file, [{ type: 'setTableCell', ref, text }])
    }

    console.log(formatOutput({ ref, text, success: true }, options.pretty))
  } catch (e) {
    const hint = await getRefHint(file, ref).catch(() => undefined)
    handleError(e, { context: { ref, file }, hint })
  }
}

async function loadHwpxSections(file: string): Promise<Section[]> {
  const archive = await loadHwpx(file)
  return parseSections(archive)
}
