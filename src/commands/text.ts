import { loadHwp, loadHwpSectionTexts } from '@/formats/hwp/reader'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { extractAllText, extractPaginatedText, extractRefText } from '@/shared/document-ops'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { getRefHint } from '@/shared/ref-hints'
import { parseRef } from '@/shared/refs'
import type { Section } from '@/types'

type TextOptions = {
  pretty?: boolean
  offset?: number
  limit?: number
}

export async function textCommand(file: string, ref: string | undefined, options: TextOptions): Promise<void> {
  try {
    const format = await detectFormat(file)
    const hasPagination = options.offset !== undefined || options.limit !== undefined

    if (format === 'hwp' && !ref && !hasPagination) {
      const allText = (await loadHwpSectionTexts(file)).join('\n')
      console.log(formatOutput({ text: allText }, options.pretty))
      return
    }

    if (format === 'hwp' && ref) {
      const parsed = parseRef(ref)
      if (parsed.image !== undefined) {
        throw new Error(`Cannot extract text from image ref: ${ref}`)
      }

      if (parsed.paragraph === undefined && parsed.table === undefined && parsed.textBox === undefined) {
        const sectionTexts = await loadHwpSectionTexts(file)
        const sectionText = sectionTexts[parsed.section]
        if (sectionText === undefined) {
          throw new Error(`Section ${parsed.section} not found`)
        }

        console.log(formatOutput({ ref, text: sectionText }, options.pretty))
        return
      }
    }

    const sections = format === 'hwp' ? (await loadHwp(file)).sections : await loadHwpxSections(file)

    if (ref) {
      const text = extractRefText(ref, sections)
      console.log(formatOutput({ ref, text }, options.pretty))
      return
    }

    if (hasPagination) {
      const result = extractPaginatedText(sections, options.offset ?? 0, options.limit ?? Number.POSITIVE_INFINITY)
      console.log(formatOutput(result, options.pretty))
      return
    }

    const allText = extractAllText(sections)
    console.log(formatOutput({ text: allText }, options.pretty))
  } catch (e) {
    const context: Record<string, unknown> = { file }
    if (ref) context.ref = ref
    const hint = ref ? await getRefHint(file, ref).catch(() => undefined) : undefined
    handleError(e, { context, hint })
  }
}

async function loadHwpxSections(file: string): Promise<Section[]> {
  const archive = await loadHwpx(file)
  return parseSections(archive)
}
