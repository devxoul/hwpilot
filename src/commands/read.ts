import { dispatchViaDaemon } from '@/daemon/dispatch'
import { loadHwp } from '@/formats/hwp/reader'
import { parseHeader } from '@/formats/hwpx/header-parser'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { resolveRef } from '@/shared/document-ops'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import { formatOutput } from '@/shared/output'
import { DocumentHeader, Paragraph } from '@/types'

type ReadOptions = {
  pretty?: boolean
  offset?: number
  limit?: number
}

export async function readCommand(file: string, ref: string | undefined, options: ReadOptions): Promise<void> {
  try {
    const daemonResult = await dispatchViaDaemon(file, 'read', {
      ref,
      offset: options.offset,
      limit: options.limit,
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
    const doc = format === 'hwp' ? await loadHwp(file) : await loadHwpxDocument(file)

if (ref) {
      const result = resolveRef(ref, doc.sections)
      // Enrich paragraph results with heading level and style name
      if (result && typeof result === 'object' && 'ref' in result && 'runs' in result) {
        const enriched = enrichParagraph(result as Paragraph, doc.header)
        console.log(formatOutput(enriched, options.pretty))
      } else {
      console.log(formatOutput(result, options.pretty))
      }
return
}

    const hasPagination = options.offset !== undefined || options.limit !== undefined
    const offset = options.offset ?? 0
    const limit = options.limit ?? Number.POSITIVE_INFINITY

    const output = {
      format: doc.format,
      sections: doc.sections.map((section, index) => {
        const paragraphs = hasPagination ? section.paragraphs.slice(offset, offset + limit) : section.paragraphs

        return {
          index,
          ...(hasPagination && {
            totalParagraphs: section.paragraphs.length,
            totalTables: section.tables.length,
            totalImages: section.images.length,
            totalTextBoxes: section.textBoxes.length,
          }),
          paragraphs: paragraphs.map(p => enrichParagraph(p, doc.header)),
          tables: section.tables,
          images: section.images,
          textBoxes: section.textBoxes,
        }
      }),
      header: doc.header,
    }

    console.log(formatOutput(output, options.pretty))
  } catch (e) {
    handleError(e)
  }
}

function enrichParagraph(para: Paragraph, header: DocumentHeader): Paragraph & { headingLevel?: number; styleName?: string } {
  const enriched: any = { ...para }

  // Resolve heading level from paraShapeRef
  const paraShape = header.paraShapes.find(ps => ps.id === para.paraShapeRef)
  if (paraShape?.headingLevel && paraShape.headingLevel > 0) {
    enriched.headingLevel = paraShape.headingLevel
  }

  // Resolve style name from styleRef
  const style = header.styles.find(s => s.id === para.styleRef)
  if (style) {
    enriched.styleName = style.name
  }

  return enriched
}

async function loadHwpxDocument(file: string) {
  const archive = await loadHwpx(file)
  const header = parseHeader(await archive.getHeaderXml())
  const sections = await parseSections(archive)

  return {
    format: 'hwpx' as const,
    sections,
    header,
  }
}
