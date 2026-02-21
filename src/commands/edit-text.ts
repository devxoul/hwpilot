import { editHwp } from '@/formats/hwp/writer'
import { editHwpx } from '@/formats/hwpx/writer'
import { type EditOperation } from '@/shared/edit-types'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { getRefHint } from '@/shared/ref-hints'
import { parseRef, validateRef } from '@/shared/refs'

export async function editTextCommand(
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
    const operation: EditOperation =
      parsed.table !== undefined ? { type: 'setTableCell', ref, text } : { type: 'setText', ref, text }

    if (format === 'hwp') {
      await editHwp(file, [operation])
    } else {
      await editHwpx(file, [operation])
    }

    console.log(formatOutput({ ref, text, success: true }, options.pretty))
  } catch (e) {
    const hint = await getRefHint(file, ref).catch(() => undefined)
    handleError(e, { context: { ref, file }, hint })
  }
}
