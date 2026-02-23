import { dispatchViaDaemon } from '@/daemon/dispatch'
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
    const daemonResult = await dispatchViaDaemon(file, 'find', { query })
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

      const matches = getMatches(daemonResult.data)
      if (options.json) {
        console.log(JSON.stringify({ matches }))
        return
      }

      for (const match of matches) {
        console.log(`${match.ref}: ${match.text}`)
      }
      return
    }

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

function getMatches(data: unknown): Array<{ ref: string; text: string }> {
  if (typeof data !== 'object' || data === null || !('matches' in data)) {
    return []
  }

  const matches = (data as { matches: unknown }).matches
  if (!Array.isArray(matches)) {
    return []
  }

  return matches.filter(
    (match): match is { ref: string; text: string } =>
      typeof match === 'object' &&
      match !== null &&
      'ref' in match &&
      typeof (match as { ref: unknown }).ref === 'string' &&
      'text' in match &&
      typeof (match as { text: unknown }).text === 'string',
  )
}
