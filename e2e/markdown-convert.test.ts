import { afterEach, describe, expect, it } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FIXTURES, parseOutput, runCli } from './helpers'

const tempFiles: string[] = []

function tempMdPath(suffix: string): string {
  const path = join(tmpdir(), `e2e-md-convert-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`)
  tempFiles.push(path)
  return path
}

afterEach(async () => {
  for (const f of tempFiles) {
    await rm(f, { force: true })
  }
  tempFiles.length = 0
})

describe('HWP → Markdown conversion', () => {
  it('converts wage claim HWP to markdown', async () => {
    const mdFile = tempMdPath('wage-claim')
    const result = await runCli(['convert', FIXTURES.wageClaim, mdFile, '--force'])
    const output = parseOutput(result) as { success: boolean }
    expect(output.success).toBe(true)

    const md = await readFile(mdFile, 'utf-8')
    expect(md.length).toBeGreaterThan(100)
    expect(md).not.toContain('<hp:')
    expect(md).not.toContain('<hh:')
    expect(md).toContain('임금')
    expect(md).toContain('원   고')
  })

  it('converts employment contract HWP to markdown', async () => {
    const mdFile = tempMdPath('employment-contract')
    const result = await runCli(['convert', FIXTURES.employmentContract, mdFile, '--force'])
    const output = parseOutput(result) as { success: boolean }
    expect(output.success).toBe(true)

    const md = await readFile(mdFile, 'utf-8')
    expect(md.length).toBeGreaterThan(100)
    expect(md).not.toContain('<hp:')
    expect(md).toContain('근로계약')
    expect(md).toContain('근로개시일')
  })

  it('converts assault complaint HWP to markdown', async () => {
    const mdFile = tempMdPath('assault-complaint')
    const result = await runCli(['convert', FIXTURES.assaultComplaint, mdFile, '--force'])
    const output = parseOutput(result) as { success: boolean }
    expect(output.success).toBe(true)

    const md = await readFile(mdFile, 'utf-8')
    expect(md.length).toBeGreaterThan(100)
    expect(md).not.toContain('<hp:')
    expect(md).toContain('폭행죄')
    expect(md).toContain('고')
  })

  it('cross-validates: HWP→MD and HWP→HWPX→MD produce substantial content', async () => {
    const mdFile1 = tempMdPath('cross-val-direct')
    const hwpxFile = join(tmpdir(), `e2e-md-convert-cross-val-${Date.now()}.hwpx`)
    const mdFile2 = tempMdPath('cross-val-via-hwpx')
    tempFiles.push(hwpxFile)

    const result1 = await runCli(['convert', FIXTURES.wageClaim, mdFile1, '--force'])
    const output1 = parseOutput(result1) as { success: boolean }
    expect(output1.success).toBe(true)

    const result2 = await runCli(['convert', FIXTURES.wageClaim, hwpxFile, '--force'])
    const output2 = parseOutput(result2) as { success: boolean }
    expect(output2.success).toBe(true)

    const result3 = await runCli(['convert', hwpxFile, mdFile2, '--force'])
    const output3 = parseOutput(result3) as { success: boolean }
    expect(output3.success).toBe(true)

    const md1 = await readFile(mdFile1, 'utf-8')
    const md2 = await readFile(mdFile2, 'utf-8')
    expect(md1.length).toBeGreaterThan(100)
    expect(md2.length).toBeGreaterThan(100)
  })

  it('output is valid markdown without XML artifacts', async () => {
    const mdFile = tempMdPath('valid-md')
    const result = await runCli(['convert', FIXTURES.wageClaim, mdFile, '--force'])
    const output = parseOutput(result) as { success: boolean }
    expect(output.success).toBe(true)

    const md = await readFile(mdFile, 'utf-8')
    expect(md).not.toContain('<hp:')
    expect(md).not.toContain('<hh:')
    expect(md).not.toContain('<hs:')
    for (let i = 0; i < 32; i++) {
      if (i !== 9 && i !== 10 && i !== 13) {
        expect(md).not.toContain(String.fromCharCode(i))
      }
    }
  })
})
