import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createHwp } from '@/formats/hwp/creator'
import { editHwp } from '@/formats/hwp/writer'
import { markdownToHwp } from '@/markdown/to-hwp'
import type { EditOperation } from '@/shared/edit-types'
import type { HwpDocument, Paragraph, Table } from '@/types'

type FlattenedItem =
  | { type: 'paragraph'; paragraph: Paragraph }
  | { type: 'table'; table: Table }
  | { type: 'sectionSeparator' }

export async function markdownToHwpBinary(md: string): Promise<Buffer> {
  const doc = markdownToHwp(md)

  if (doc.sections.some((section) => section.images.length > 0)) {
    console.warn('Warning: images are not supported in HWP binary output and will be skipped')
  }

  const flattenedItems = flattenSections(doc)
  const structureOps: EditOperation[] = []
  const formatOps: EditOperation[] = []
  const paragraphTargets: Array<{ paragraph: Paragraph; paragraphIndex: number }> = []

  let paragraphIndex = 0
  for (const item of flattenedItems) {
    if (item.type === 'paragraph') {
      const headingLevel = doc.header.paraShapes[item.paragraph.paraShapeRef]?.headingLevel
      const heading = headingLevel && headingLevel > 0 ? headingLevel : undefined
      const text = item.paragraph.runs.map((run) => run.text).join('')

      structureOps.push({
        type: 'addParagraph',
        ref: 's0',
        text,
        position: 'end',
        heading,
      })
      paragraphTargets.push({ paragraph: item.paragraph, paragraphIndex })
      paragraphIndex += 1
      continue
    }

    if (item.type === 'table') {
      const rowCount = item.table.rows.length
      const colCount = item.table.rows[0]?.cells.length ?? 0
      const data = item.table.rows.map((row) =>
        row.cells.map((cell) => cell.paragraphs[0]?.runs.map((run) => run.text).join('') ?? ''),
      )

      structureOps.push({
        type: 'addTable',
        ref: 's0',
        rows: rowCount,
        cols: colCount,
        data,
        position: 'end',
      })
      continue
    }

    structureOps.push({
      type: 'addParagraph',
      ref: 's0',
      text: '',
      position: 'end',
    })
    paragraphIndex += 1
  }

  for (const target of paragraphTargets) {
    let charOffset = 0
    for (const run of target.paragraph.runs) {
      const charShape = doc.header.charShapes[run.charShapeRef]
      const bold = charShape?.bold === true ? true : undefined
      const italic = charShape?.italic === true ? true : undefined

      if (run.text.length > 0 && (bold || italic)) {
        formatOps.push({
          type: 'setFormat',
          ref: `s0.p${target.paragraphIndex + 1}`,
          format: {
            bold,
            italic,
          },
          start: charOffset,
          end: charOffset + run.text.length,
        })
      }

      charOffset += run.text.length
    }
  }

  const tempPath = join(
    tmpdir(),
    `hwpilot-markdown-${Date.now()}-${Math.random().toString(16).slice(2)}.hwp`,
  )

  try {
    const base = await createHwp({ font: '맑은 고딕', fontSize: 10 })
    await writeFile(tempPath, base)
    await editHwp(tempPath, [...structureOps, ...formatOps])
    return await readFile(tempPath)
  } finally {
    await unlink(tempPath).catch(() => {})
  }
}

function flattenSections(doc: HwpDocument): FlattenedItem[] {
  const items: FlattenedItem[] = []

  doc.sections.forEach((section, index) => {
    items.push(...section.paragraphs.map((paragraph) => ({ type: 'paragraph', paragraph }) as const))
    items.push(...section.tables.map((table) => ({ type: 'table', table }) as const))

    if (index < doc.sections.length - 1) {
      items.push({ type: 'sectionSeparator' })
    }
  })

  return items
}
