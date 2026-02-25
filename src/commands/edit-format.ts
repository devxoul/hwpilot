import { dispatchViaDaemon } from '@/daemon/dispatch'
import { editHwp } from '@/formats/hwp/writer'
import { editHwpx } from '@/formats/hwpx/writer'
import { type FormatOptions } from '@/shared/edit-types'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { getRefHint } from '@/shared/ref-hints'
import { validateRef } from '@/shared/refs'

type FormatCommandOptions = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  font?: string
  size?: number
  color?: string
  start?: number
  end?: number
  pretty?: boolean
}

export async function editFormatCommand(file: string, ref: string, options: FormatCommandOptions): Promise<void> {
  try {
    // Validate start/end
    if ((options.start !== undefined) !== (options.end !== undefined)) {
      throw new Error('Both --start and --end must be specified together')
    }
    if (options.start !== undefined && options.end !== undefined && options.start >= options.end) {
      throw new Error('--start must be less than --end')
    }
    if (options.start !== undefined && options.start < 0) {
      throw new Error('--start must be non-negative')
    }

    const daemonResult = await dispatchViaDaemon(file, 'edit-format', {
      ref,
      format: {
        bold: options.bold,
        italic: options.italic,
        underline: options.underline,
        fontName: options.font,
        fontSize: options.size,
        color: options.color,
      },
      start: options.start,
      end: options.end,
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

    const fileFormat = await detectFormat(file)

    if (!validateRef(ref)) {
      throw new Error(`Invalid reference: ${ref}`)
    }

    const format: FormatOptions = {}
    if (options.bold !== undefined) format.bold = options.bold
    if (options.italic !== undefined) format.italic = options.italic
    if (options.underline !== undefined) format.underline = options.underline
    if (options.font !== undefined) format.fontName = options.font
    if (options.size !== undefined) format.fontSize = options.size
    if (options.color !== undefined) format.color = options.color

    if (Object.keys(format).length === 0) {
      throw new Error('No format options specified')
    }

    if (fileFormat === 'hwp') {
      await editHwp(file, [{ type: 'setFormat', ref, format, start: options.start, end: options.end }])
    } else {
      await editHwpx(file, [{ type: 'setFormat', ref, format, start: options.start, end: options.end }])
    }

    console.log(formatOutput({ ref, format, success: true }, options.pretty))
  } catch (e) {
    const hint = await getRefHint(file, ref).catch(() => undefined)
    handleError(e, { context: { ref, file }, hint })
  }
}
