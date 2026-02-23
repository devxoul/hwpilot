import { loadHwp } from '@/formats/hwp/reader'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { findInSections } from '@/shared/document-ops'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import type { Section } from '@/types'

type FindOptions = {
  json?: boolean
}

export async function findCommand(file: string, query: string, options: FindOptions): Promise<void> {
  try {
    const format = await detectFormat(file)
    const sections = format === 'hwp' ? (await loadHwp(file)).sections : await loadHwpxSections(file)

    const matches = findInSections(sections, query)

    if (options.json) {
      console.log(JSON.stringify({ matches }))
      return
    }

    for (const match of matches) {
      console.log(`${match.ref}: ${match.text}`)
    }
  } catch (e) {
    handleError(e, { context: { file, query } })
  }
}

async function loadHwpxSections(file: string): Promise<Section[]> {
  const archive = await loadHwpx(file)
  return parseSections(archive)
}
