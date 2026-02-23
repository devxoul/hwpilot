import { rename, rm, writeFile } from 'node:fs/promises'
import type JSZip from 'jszip'
import type { FlushScheduler } from '@/daemon/flush'
import { parseHeader } from '@/formats/hwpx/header-parser'
import { type HwpxArchive, loadHwpx } from '@/formats/hwpx/loader'
import { mutateHwpxZip } from '@/formats/hwpx/mutator'
import { parseSections } from '@/formats/hwpx/section-parser'
import type { EditOperation } from '@/shared/edit-types'
import type { DocumentHeader, Section } from '@/types'

export class HwpxHolder {
  private readonly filePath: string
  private archive: HwpxArchive | null = null
  private zip: JSZip | null = null
  private sectionsCache: Section[] | null = null
  private headerCache: DocumentHeader | null = null
  private dirty = false

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load(): Promise<void> {
    this.archive = await loadHwpx(this.filePath)
    this.zip = this.archive.getZip()
    this.sectionsCache = null
    this.headerCache = null
    this.dirty = false
  }

  async getSections(): Promise<Section[]> {
    const archive = this.requireArchive()

    if (!this.sectionsCache) {
      this.sectionsCache = await parseSections(archive)
    }

    return this.sectionsCache
  }

  async applyOperations(ops: EditOperation[]): Promise<void> {
    if (ops.length === 0) {
      return
    }

    const archive = this.requireArchive()
    const zip = this.requireZip()

    await mutateHwpxZip(zip, archive, ops)
    this.sectionsCache = null
    this.headerCache = null
    this.dirty = true
  }

  async flush(): Promise<void> {
    if (!this.dirty) {
      return
    }

    const zip = this.requireZip()
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    const tmpPath = `${this.filePath}.tmp`

    try {
      await writeFile(tmpPath, buffer)
      await rename(tmpPath, this.filePath)
    } catch (error) {
      await rm(tmpPath, { force: true })
      throw error
    }

    this.dirty = false
  }

  isDirty(): boolean {
    return this.dirty
  }

  async getHeader(): Promise<DocumentHeader> {
    if (!this.headerCache) {
      const archive = this.requireArchive()
      this.headerCache = parseHeader(await archive.getHeaderXml())
    }
    return this.headerCache
  }

  getFormat(): 'hwpx' {
    return 'hwpx'
  }

  scheduleFlush(scheduler: FlushScheduler): void {
    if (this.dirty) {
      scheduler.schedule()
    }
  }

  private requireArchive(): HwpxArchive {
    if (!this.archive) {
      throw new Error('HwpxHolder is not loaded. Call load() first.')
    }

    return this.archive
  }

  private requireZip(): JSZip {
    if (!this.zip) {
      throw new Error('HwpxHolder is not loaded. Call load() first.')
    }

    return this.zip
  }
}
