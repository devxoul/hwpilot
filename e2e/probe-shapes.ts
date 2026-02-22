import { mkdir, readFile, writeFile } from 'node:fs/promises'
import CFB from 'cfb'
import { inflateRaw } from 'pako'
import { iterateRecords } from '../src/formats/hwp/record-parser'
import { TAG } from '../src/formats/hwp/tag-ids'
import { detectFormat } from '../src/shared/format-detector'
import { FIXTURES } from './helpers'

interface ProbeResult {
  fixture: string
  fileName: string
  format: string
  gsoCount: number
  textBoxCount: number
  textBoxTexts: string[]
}

async function probeHwpFixture(key: string, filePath: string): Promise<ProbeResult> {
  const fileBuffer = await readFile(filePath)
  const format = await detectFormat(filePath)

  if (format !== 'hwp') {
    return {
      fixture: key,
      fileName: filePath.split('/').pop() || '',
      format,
      gsoCount: 0,
      textBoxCount: 0,
      textBoxTexts: [],
    }
  }

  // Open CFB file
  const cfb = CFB.read(fileBuffer, { type: 'buffer' })

  // Get compression flag from FileHeader
  const fileHeaderEntry = CFB.find(cfb, 'FileHeader')
  if (!fileHeaderEntry?.content) {
    throw new Error(`Invalid HWP file: FileHeader not found in ${filePath}`)
  }

  const headerContent = Buffer.from(fileHeaderEntry.content)
  const flags = headerContent.readUInt32LE(36)
  const isCompressed = Boolean(flags & 0x1)

  // Iterate through all sections
  let gsoCount = 0
  let textBoxCount = 0
  const textBoxTexts: string[] = []

  let sectionIndex = 0
  while (true) {
    const sectionEntry = CFB.find(cfb, `/BodyText/Section${sectionIndex}`)
    if (!sectionEntry?.content) {
      break
    }

    const raw = Buffer.from(sectionEntry.content)
    const sectionBuffer = isCompressed ? Buffer.from(inflateRaw(raw)) : raw

    // Iterate records in this section
    let inGsoShape = false
    let inTextBoxContent = false
    let textBoxTextBuffer: string[] = []

    for (const record of iterateRecords(sectionBuffer)) {
      const { tagId, level } = record.header
      const { data } = record

      // Check for CTRL_HEADER with GSO marker (level 0 = new shape)
      if (tagId === TAG.CTRL_HEADER && level === 0) {
        if (data.length >= 4) {
          const marker = data.subarray(0, 4).toString('ascii')
          if (marker === 'gso ') {
            gsoCount++
            inGsoShape = true
            inTextBoxContent = false
          } else {
            inGsoShape = false
          }
        }
      }

      // Check for SHAPE_COMPONENT_RECTANGLE (text box container, level > 0 = nested)
      if (tagId === TAG.SHAPE_COMPONENT_RECTANGLE && inGsoShape && level > 0) {
        inTextBoxContent = true
        textBoxTextBuffer = []
      }

      // Check for LIST_HEADER (marks start of text box paragraphs)
      if (tagId === TAG.LIST_HEADER && inTextBoxContent && level > 0) {
        textBoxCount++
      }

      // Collect text from PARA_TEXT records inside text boxes
      if (tagId === TAG.PARA_TEXT && inTextBoxContent && level > 0) {
        // PARA_TEXT data is UTF-16LE encoded
        if (data.length >= 2) {
          const text = data.toString('utf16le')
          textBoxTextBuffer.push(text)
        }
      }

      // Exit text box when we hit another CTRL_HEADER at level 0
      if (tagId === TAG.CTRL_HEADER && level === 0 && inTextBoxContent) {
        if (textBoxTextBuffer.length > 0) {
          textBoxTexts.push(textBoxTextBuffer.join(''))
        }
        inTextBoxContent = false
        textBoxTextBuffer = []
      }
    }

    // Handle any remaining text box text at end of section
    if (inTextBoxContent && textBoxTextBuffer.length > 0) {
      textBoxTexts.push(textBoxTextBuffer.join(''))
    }

    sectionIndex++
  }

  return {
    fixture: key,
    fileName: filePath.split('/').pop() || '',
    format,
    gsoCount,
    textBoxCount,
    textBoxTexts,
  }
}

async function main() {
  const results: ProbeResult[] = []

  for (const [key, path] of Object.entries(FIXTURES)) {
    console.log(`Probing ${key}...`)
    try {
      const result = await probeHwpFixture(key, path)
      results.push(result)
      console.log(`  ✓ ${key}: ${result.gsoCount} GSO shapes, ${result.textBoxCount} text boxes`)
      if (result.textBoxTexts.length > 0) {
        console.log(`    Text box contents: ${result.textBoxTexts.slice(0, 3).join(' | ')}`)
      }
    } catch (e) {
      console.error(`  ✗ ${key}: ${e}`)
    }
  }

  // Ensure evidence directory exists
  const evidenceDir = '.sisyphus/evidence'
  await mkdir(evidenceDir, { recursive: true })

  // Save results
  await writeFile(`${evidenceDir}/task-3-probe-results.json`, JSON.stringify(results, null, 2))
  console.log(`\nWrote ${evidenceDir}/task-3-probe-results.json`)

  // Update fixture-capabilities.json with textBoxCount
  const capabilitiesPath = 'e2e/fixture-capabilities.json'
  const capabilitiesBuffer = await readFile(capabilitiesPath, 'utf-8')
  const capabilities = JSON.parse(capabilitiesBuffer) as Record<string, any>

  for (const result of results) {
    if (capabilities[result.fixture]) {
      capabilities[result.fixture].textBoxCount = result.textBoxCount
    }
  }

  await writeFile(capabilitiesPath, JSON.stringify(capabilities, null, 2))
  console.log(`Updated e2e/fixture-capabilities.json with textBoxCount`)
}

main().catch(console.error)
