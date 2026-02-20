import { describe, expect, it } from 'bun:test'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestHwpx } from '../../test-helpers'
import { loadHwpx } from './loader'

const tmp = (name: string) => join(tmpdir(), name)

describe('loadHwpx', () => {
  it('loads a valid HWPX file', async () => {
    const buf = await createTestHwpx({ paragraphs: ['Hello'] })
    const path = tmp('test-load.hwpx')
    await writeFile(path, buf)
    try {
      const archive = await loadHwpx(path)
      expect(archive).toBeTruthy()
    } finally {
      await unlink(path)
    }
  })

  it('getHeaderXml returns XML string', async () => {
    const buf = await createTestHwpx()
    const path = tmp('test-header.hwpx')
    await writeFile(path, buf)
    try {
      const archive = await loadHwpx(path)
      const xml = await archive.getHeaderXml()
      expect(xml).toContain('hh:head')
      expect(xml).toContain('맑은 고딕')
    } finally {
      await unlink(path)
    }
  })

  it('getSectionXml returns section XML', async () => {
    const buf = await createTestHwpx({ paragraphs: ['Section text'] })
    const path = tmp('test-section.hwpx')
    await writeFile(path, buf)
    try {
      const archive = await loadHwpx(path)
      const xml = await archive.getSectionXml(0)
      expect(xml).toContain('hs:sec')
      expect(xml).toContain('Section text')
    } finally {
      await unlink(path)
    }
  })

  it('getSectionCount returns correct count', async () => {
    const buf = await createTestHwpx()
    const path = tmp('test-count.hwpx')
    await writeFile(path, buf)
    try {
      const archive = await loadHwpx(path)
      expect(archive.getSectionCount()).toBe(1)
    } finally {
      await unlink(path)
    }
  })

  it('throws descriptive error for non-existent file', async () => {
    await expect(loadHwpx('/nonexistent/path/file.hwpx')).rejects.toThrow()
  })

  it('throws descriptive error for invalid ZIP', async () => {
    const path = tmp('not-a-zip.hwpx')
    await writeFile(path, Buffer.from('this is not a zip file'))
    try {
      await expect(loadHwpx(path)).rejects.toThrow()
    } finally {
      await unlink(path)
    }
  })

  it('throws error if header.xml is missing', async () => {
    // Create a valid ZIP but without the required HWPX entries
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('version.xml', '<version/>')
    // Intentionally missing Contents/header.xml
    const buf = await zip.generateAsync({ type: 'nodebuffer' })
    const path = tmp('missing-header.hwpx')
    await writeFile(path, buf)
    try {
      await expect(loadHwpx(path)).rejects.toThrow(/header/)
    } finally {
      await unlink(path)
    }
  })

  it('getVersionXml returns version XML', async () => {
    const buf = await createTestHwpx()
    const path = tmp('test-version.hwpx')
    await writeFile(path, buf)
    try {
      const archive = await loadHwpx(path)
      const xml = await archive.getVersionXml()
      expect(xml).toContain('version')
    } finally {
      await unlink(path)
    }
  })
})
