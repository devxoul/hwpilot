import { describe, expect, it } from 'bun:test'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import CFB from 'cfb'
import { getEntryBuffer, mutateHwpCfb } from './mutator'
import { loadHwp } from './reader'
import { getCompressionFlag } from './stream-util'

const fixture = 'e2e/fixtures/임금 등 청구의 소.hwp'
const tmpPath = (name: string) => join(tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.hwp`)

describe('mutateHwpCfb', () => {
  it('applies setText to first paragraph in-memory', async () => {
    const buf = await readFile(fixture)
    const cfb = CFB.read(buf, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    mutateHwpCfb(cfb, [{ type: 'setText', ref: 's0.p0', text: 'MUTATED' }], compressed)

    // write to temp, read back independently
    const outPath = tmpPath('mutator-setText')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const doc = await loadHwp(outPath)
      const firstText = doc.sections[0].paragraphs[0].runs.map((r) => r.text).join('')
      expect(firstText).toBe('MUTATED')
    } finally {
      await unlink(outPath)
    }
  })

  it('no-ops on empty operations', async () => {
    const buf = await readFile(fixture)
    const cfb = CFB.read(buf, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    // should not throw
    mutateHwpCfb(cfb, [], compressed)
  })

  it('preserves non-target paragraphs', async () => {
    const buf = await readFile(fixture)
    const cfb = CFB.read(buf, { type: 'buffer' })
    const compressed = getCompressionFlag(getEntryBuffer(cfb, '/FileHeader'))

    // read original second paragraph
    const origDoc = await loadHwp(fixture)
    const origSecondText = origDoc.sections[0].paragraphs[1]?.runs.map((r) => r.text).join('')

    mutateHwpCfb(cfb, [{ type: 'setText', ref: 's0.p0', text: 'CHANGED' }], compressed)

    const outPath = tmpPath('mutator-preserve')
    await writeFile(outPath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))

    try {
      const doc = await loadHwp(outPath)
      const secondText = doc.sections[0].paragraphs[1]?.runs.map((r) => r.text).join('')
      expect(secondText).toBe(origSecondText)
    } finally {
      await unlink(outPath)
    }
  })
})
