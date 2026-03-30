import { afterEach, describe, expect, it } from 'bun:test'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createTestHwpBinary, createTestHwpx } from '@/test-helpers'

import { createHwpFile, editFile, openFile } from '@/node/index'

const TMP_FILES: string[] = []

afterEach(async () => {
  await Promise.all(TMP_FILES.splice(0).map((file) => unlink(file).catch(() => {})))
})

function tmpPath(name: string): string {
  return join(tmpdir(), name)
}

describe('openFile()', () => {
  it('opens an HWPX file and returns an HwpDocument', async () => {
    const filePath = tmpPath('test-node-open-hwpx.hwpx')
    TMP_FILES.push(filePath)
    const bytes = await createTestHwpx({ paragraphs: ['Hello'] })
    await writeFile(filePath, bytes)

    const doc = await openFile(filePath)
    expect(doc.format).toBe('hwpx')
    expect(Array.isArray(doc.sections)).toBe(true)
  })

  it('opens an HWP file and returns an HwpDocument', async () => {
    const filePath = tmpPath('test-node-open-hwp.hwp')
    TMP_FILES.push(filePath)
    const bytes = await createTestHwpBinary({ paragraphs: ['Hello'] })
    await writeFile(filePath, bytes)

    const doc = await openFile(filePath)
    expect(doc.format).toBe('hwp')
    expect(Array.isArray(doc.sections)).toBe(true)
  })

  it('throws for non-existent file', async () => {
    await expect(openFile('/nonexistent/path/does-not-exist-hwpilot.hwpx')).rejects.toThrow()
  })
})

describe('editFile()', () => {
  it('edits a file in-place and persists the changes', async () => {
    const filePath = tmpPath('test-node-edit-file.hwpx')
    TMP_FILES.push(filePath)
    const bytes = await createTestHwpx({ paragraphs: ['Original'] })
    await writeFile(filePath, bytes)

    await editFile(filePath, [{ type: 'setText', ref: 's0.p0', text: 'Edited' }])

    const doc = await openFile(filePath)
    const allText = doc.sections
      .flatMap((s) => s.paragraphs)
      .flatMap((p) => p.runs)
      .map((r) => r.text)
      .join('')
    expect(allText).toContain('Edited')
  })
})

describe('createHwpFile()', () => {
  it('creates a new HWP file at the given path', async () => {
    const filePath = tmpPath('test-node-create.hwp')
    TMP_FILES.push(filePath)

    await createHwpFile(filePath)

    const doc = await openFile(filePath)
    expect(doc.format).toBe('hwp')
    expect(Array.isArray(doc.sections)).toBe(true)
  })
})
