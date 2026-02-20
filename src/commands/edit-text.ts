import { editHwpx } from '@/formats/hwpx/writer'
import { type EditOperation } from '@/shared/edit-types'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { parseRef, validateRef } from '@/shared/refs'

export async function editTextCommand(
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
    const operation: EditOperation =
      parsed.table !== undefined ? { type: 'setTableCell', ref, text } : { type: 'setText', ref, text }

    await editHwpx(file, [operation])

    console.log(formatOutput({ ref, text, success: true }, options.pretty))
  } catch (e) {
    handleError(e)
  }
}
