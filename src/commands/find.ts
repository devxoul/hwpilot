import { loadHwp } from '@/formats/hwp/reader'
import { loadHwpx } from '@/formats/hwpx/loader'
import { parseSections } from '@/formats/hwpx/section-parser'
import { handleError } from '@/shared/error-handler'
import { detectFormat } from '@/shared/format-detector'
import type { Section } from '@/types'

type FindOptions = {
  json?: boolean
}

type Match = {
  ref: string
  text: string
  container: 'paragraph' | 'table' | 'textBox'
}

export async function findCommand(file: string, query: string, options: FindOptions): Promise<void> {
  try {
    const format = await detectFormat(file)
    const sections = format === 'hwp' ? (await loadHwp(file)).sections : await loadHwpxSections(file)

    const matches = searchSections(sections, query)

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

function searchSections(sections: Section[], query: string): Match[] {
  const matches: Match[] = []
  const lowerQuery = query.toLowerCase()

  for (const section of sections) {
    for (const para of section.paragraphs) {
      const text = para.runs.map((r) => r.text).join('')
      if (text.toLowerCase().includes(lowerQuery)) {
        matches.push({ ref: para.ref, text, container: 'paragraph' })
      }
    }

    for (const table of section.tables) {
      for (const row of table.rows) {
        for (const cell of row.cells) {
          for (const para of cell.paragraphs) {
            const text = para.runs.map((r) => r.text).join('')
            if (text.toLowerCase().includes(lowerQuery)) {
              matches.push({ ref: para.ref, text, container: 'table' })
            }
          }
        }
      }
    }

    for (const textBox of section.textBoxes) {
      for (const para of textBox.paragraphs) {
        const text = para.runs.map((r) => r.text).join('')
        if (text.toLowerCase().includes(lowerQuery)) {
          matches.push({ ref: para.ref, text, container: 'textBox' })
        }
      }
    }
  }

  return matches
}
