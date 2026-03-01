import { dispatchViaDaemon } from '@/daemon/dispatch'
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
import { buildRef, parseRef, validateRef } from '@/shared/refs'
import type { Section } from '@/types'

export async function tableReadCommand(file: string, ref: string, options: { pretty?: boolean }): Promise<void> {
  try {
    const daemonResult = await dispatchViaDaemon(file, 'table-read', { ref })
    if (daemonResult !== null) {
      if (!daemonResult.success) {
        const errorOptions =
          daemonResult.context && typeof daemonResult.context === 'object'
            ? { context: daemonResult.context as Record<string, unknown>, hint: daemonResult.hint }
            : daemonResult.hint
              ? { hint: daemonResult.hint }
              : undefined
        handleError(new Error(daemonResult.error), errorOptions)
        return
      }

      console.log(formatOutput(daemonResult.data, options.pretty))
      return
    }

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
    const daemonResult = await dispatchViaDaemon(file, 'table-list', {})
    if (daemonResult !== null) {
      if (!daemonResult.success) {
        const errorOptions =
          daemonResult.context && typeof daemonResult.context === 'object'
            ? { context: daemonResult.context as Record<string, unknown>, hint: daemonResult.hint }
            : daemonResult.hint
              ? { hint: daemonResult.hint }
              : undefined
        handleError(new Error(daemonResult.error), errorOptions)
        return
      }

      console.log(formatOutput(daemonResult.data, options.pretty))
      return
    }

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
    const daemonResult = await dispatchViaDaemon(file, 'table-edit', {
      ref,
      text,
    })
    if (daemonResult !== null) {
      if (!daemonResult.success) {
        const errorOptions =
          daemonResult.context && typeof daemonResult.context === 'object'
            ? { context: daemonResult.context as Record<string, unknown>, hint: daemonResult.hint }
            : daemonResult.hint
              ? { hint: daemonResult.hint }
              : undefined
        handleError(new Error(daemonResult.error), errorOptions)
        return
      }

      console.log(formatOutput(daemonResult.data, options.pretty))
      return
    }

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

export async function tableAddCommand(
  file: string,
  ref: string,
  rows: number,
  cols: number,
  options: { position?: string; data?: string; pretty?: boolean },
): Promise<void> {
  try {
    const position = (options.position ?? 'end') as 'before' | 'after' | 'end'

    if (!['before', 'after', 'end'].includes(position)) {
      throw new Error(`Invalid position: ${position}. Must be 'before', 'after', or 'end'`)
    }

    if (!validateRef(ref)) {
      throw new Error(`Invalid reference: ${ref}`)
    }

    const parsedRef = parseRef(ref)

    if ((position === 'before' || position === 'after') && parsedRef.paragraph === undefined) {
      throw new Error(
        `table add with position '${position}' requires a paragraph reference (e.g., s0.p0)`,
      )
    }

    const data: string[][] | undefined = options.data ? JSON.parse(options.data) : undefined

    if (data) {
      if (!Array.isArray(data) || !data.every((r) => Array.isArray(r))) {
        throw new Error('--data must be a JSON array of arrays')
      }
    }

    const daemonResult = await dispatchViaDaemon(file, 'table-add', { ref, rows, cols, data, position })
    if (daemonResult !== null) {
      if (!daemonResult.success) {
        const errorOptions =
          daemonResult.context && typeof daemonResult.context === 'object'
            ? { context: daemonResult.context as Record<string, unknown>, hint: daemonResult.hint }
            : daemonResult.hint
              ? { hint: daemonResult.hint }
              : undefined
        handleError(new Error(daemonResult.error), errorOptions)
        return
      }

      console.log(formatOutput(daemonResult.data, options.pretty))
      return
    }

    const format = await detectFormat(file)

    const sections = format === 'hwp' ? (await loadHwp(file)).sections : await loadHwpxSections(file)
    const tableCount = sections[parsedRef.section]?.tables.length ?? 0

    if (format === 'hwp') {
      await editHwp(file, [{ type: 'addTable', ref, rows, cols, data, position }])
    } else {
      await editHwpx(file, [{ type: 'addTable', ref, rows, cols, data, position }])
    }

    const newRef = buildRef({ section: parsedRef.section, table: tableCount })
    console.log(formatOutput({ ref: newRef, rows, cols, success: true }, options.pretty))
  } catch (e) {
    const hint = await getRefHint(file, ref).catch(() => undefined)
    handleError(e, { context: { ref, file }, hint })
  }
}

async function loadHwpxSections(file: string): Promise<Section[]> {
  const archive = await loadHwpx(file)
  return parseSections(archive)
}
