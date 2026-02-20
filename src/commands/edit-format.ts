import { editHwpx } from '@/formats/hwpx/writer'
import { type FormatOptions } from '@/shared/edit-types'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { validateRef } from '@/shared/refs'

type FormatCommandOptions = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  font?: string
  size?: number
  color?: string
  pretty?: boolean
}

export async function editFormatCommand(file: string, ref: string, options: FormatCommandOptions): Promise<void> {
  try {
    const fileFormat = await detectFormat(file)

    if (fileFormat === 'hwp') {
      throw new Error('HWP 5.0 write not supported')
    }

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

    await editHwpx(file, [{ type: 'setFormat', ref, format }])

    console.log(formatOutput({ ref, format, success: true }, options.pretty))
  } catch (e) {
    handleError(e)
  }
}
