import { dispatchViaDaemon } from '@/daemon/dispatch'
import { editHwp } from '@/formats/hwp/writer'
import { editHwpx } from '@/formats/hwpx/writer'
import { type FormatOptions } from '@/shared/edit-types'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { getRefHint } from '@/shared/ref-hints'
import { validateRef } from '@/shared/refs'

type ParagraphAddCommandOptions = {
  position?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  font?: string
  size?: number
  color?: string
  heading?: number
  style?: string | number
  pretty?: boolean
}

export async function paragraphAddCommand(
  file: string,
  ref: string,
  text: string,
  options: ParagraphAddCommandOptions,
): Promise<void> {
  try {
    const position = options.position ?? 'end'

    // Validate position
    if (!['before', 'after', 'end'].includes(position)) {
      throw new Error(`Invalid position: ${position}. Must be 'before', 'after', or 'end'`)
    }

    // Validate heading and style are mutually exclusive
    if (options.heading !== undefined && options.style !== undefined) {
      throw new Error('Cannot specify both --heading and --style')
    }

    // Validate heading level
    if (options.heading !== undefined) {
      if (options.heading < 1 || options.heading > 7) {
        throw new Error('Heading level must be between 1 and 7')
      }
    }

    // Build format object from options
    const format: FormatOptions = {}
    if (options.bold !== undefined) format.bold = options.bold
    if (options.italic !== undefined) format.italic = options.italic
    if (options.underline !== undefined) format.underline = options.underline
    if (options.font !== undefined) format.fontName = options.font
    if (options.size !== undefined) format.fontSize = options.size
    if (options.color !== undefined) format.color = options.color

    const daemonResult = await dispatchViaDaemon(file, 'paragraph-add', {
      ref,
      text,
      position,
      format: Object.keys(format).length > 0 ? format : undefined,
      heading: options.heading,
      style: options.style,
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

    if (fileFormat === 'hwp') {
      await editHwp(file, [
        {
          type: 'addParagraph',
          ref,
          text,
          position: position as 'before' | 'after' | 'end',
          format: Object.keys(format).length > 0 ? format : undefined,
          heading: options.heading,
          style: options.style,
        },
      ])
    } else {
      await editHwpx(file, [
        {
          type: 'addParagraph',
          ref,
          text,
          position: position as 'before' | 'after' | 'end',
          format: Object.keys(format).length > 0 ? format : undefined,
          heading: options.heading,
          style: options.style,
        },
      ])
    }

    console.log(formatOutput({ ref, text, position, success: true }, options.pretty))
  } catch (e) {
    const hint = await getRefHint(file, ref).catch(() => undefined)
    handleError(e, { context: { ref, file }, hint })
  }
}
