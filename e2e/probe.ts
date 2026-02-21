import { writeFile } from 'node:fs/promises'
import { cleanupFiles, FIXTURES, runCli, tempCopy } from './helpers'

async function probeFixture(key: string, fixturePath: string) {
  // 1. Read document structure
  const readResult = await runCli(['read', fixturePath])
  const doc = JSON.parse(readResult.stdout) as any

  // 2. Collect per-section data
  const sections = doc.sections || []

  // 3. For each section, try editing paragraphs to find max editable index
  const editableParagraphs: Record<string, number[]> = {}

  for (let sectionIdx = 0; sectionIdx < sections.length; sectionIdx++) {
    const sectionParas = sections[sectionIdx]?.paragraphs || []
    const editableInSection: number[] = []

    // Create a temp copy for this probe
    const temp = await tempCopy(fixturePath)
    try {
      // Try editing each paragraph ref until failure, up to max 50 or actual count
      const maxToCheck = Math.min(sectionParas.length, 50)
      for (let pIdx = 0; pIdx < maxToCheck; pIdx++) {
        const ref = `s${sectionIdx}.p${pIdx}`
        const result = await runCli(['edit', 'text', temp, ref, 'PROBE'])
        if (result.exitCode === 0) {
          editableInSection.push(pIdx)
          // Once we find one that fails after a run of successes, we can stop
          // But let's be conservative and check all up to first failure after some successes
        } else {
          // If we already found some editable ones and this fails, stop checking
          if (editableInSection.length > 0) break
          // If we haven't found any yet, keep trying next few
          if (pIdx > 5) break
        }
      }
    } finally {
      await cleanupFiles([temp])
    }

    editableParagraphs[`s${sectionIdx}`] = editableInSection
  }

  // 4. Get first line text
  const textResult = await runCli(['text', fixturePath, 's0.p0'])
  const firstLineText = JSON.parse(textResult.stdout)?.text?.trim() || ''

  // 5. Count images from read output (via read command structure)
  const imageCount = sections.reduce((sum: number, s: any) => sum + (s.images?.length || 0), 0)

  return {
    key,
    fileName: fixturePath.split('/').pop(),
    format: doc.format,
    sectionCount: sections.length,
    paragraphsReported: sections.map((s: any) => s.paragraphs?.length || 0),
    editableParagraphs,
    tableCount: 0, // all fixtures return 0 tables
    imageCount,
    firstLineText,
  }
}

async function main() {
  const results: Record<string, any> = {}

  for (const [key, path] of Object.entries(FIXTURES)) {
    console.log(`Probing ${key}...`)
    try {
      results[key] = await probeFixture(key, path)
      console.log(`  ✓ ${key}: ${results[key].sectionCount} sections`)
      for (const [section, editable] of Object.entries(results[key].editableParagraphs)) {
        console.log(
          `    ${section}: ${(editable as number[]).length} editable (indices: ${(editable as number[]).join(', ')})`,
        )
      }
    } catch (e) {
      console.error(`  ✗ ${key}: ${e}`)
    }
  }

  await writeFile('e2e/fixture-capabilities.json', JSON.stringify(results, null, 2))
  console.log('\nWrote e2e/fixture-capabilities.json')
}

main()
