import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import CFB from 'cfb'
import type { FlushScheduler } from '@/daemon/flush'
import { mutateHwpCfb } from '@/formats/hwp/mutator'
import { loadHwp, loadHwpSectionTexts } from '@/formats/hwp/reader'
import { getCompressionFlag } from '@/formats/hwp/stream-util'
import type { EditOperation } from '@/shared/edit-types'
import type { DocumentHeader, Section } from '@/types'

export class HwpHolder {
  private readonly filePath: string
  private cfb: CFB.CFB$Container | null = null
  private compressed = false
  private sectionsCache: Section[] | null = null
  private headerCache: DocumentHeader | null = null
  private dirty = false

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async load(): Promise<void> {
    const buffer = await readFile(this.filePath)
    this.cfb = CFB.read(buffer, { type: 'buffer' })
    this.compressed = getCompressionFlag(this.getFileHeaderBuffer(this.cfb))
    this.sectionsCache = null
    this.headerCache = null
    this.dirty = false
  }

  async getSections(): Promise<Section[]> {
    const cfb = this.requireCfb()

    if (!this.sectionsCache) {
      const tempPath = `${this.filePath}.holder-${randomUUID()}.tmp.hwp`

      try {
        await writeFile(tempPath, this.serializeCfb(cfb))
        const doc = await loadHwp(tempPath)
        this.sectionsCache = doc.sections
        this.headerCache = doc.header
      } finally {
        await rm(tempPath, { force: true })
      }
    }

    return this.sectionsCache
  }

  async getSectionTexts(): Promise<string[]> {
    const cfb = this.requireCfb()
    const tempPath = `${this.filePath}.holder-${randomUUID()}.tmp.hwp`
    try {
      await writeFile(tempPath, this.serializeCfb(cfb))
      return await loadHwpSectionTexts(tempPath)
    } finally {
      await rm(tempPath, { force: true })
    }
  }

  async applyOperations(ops: EditOperation[]): Promise<void> {
    if (ops.length === 0) {
      return
    }

    const cfb = this.requireCfb()
    mutateHwpCfb(cfb, ops, this.compressed)
    this.sectionsCache = null
    this.headerCache = null
    this.dirty = true
  }

  async flush(): Promise<void> {
    if (!this.dirty) {
      return
    }

    const cfb = this.requireCfb()
    const tmpPath = `${this.filePath}.tmp`

    try {
      await writeFile(tmpPath, this.serializeCfb(cfb))
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
    await this.getSections()
    return this.headerCache!
  }

  getFormat(): 'hwp' {
    return 'hwp'
  }

  scheduleFlush(scheduler: FlushScheduler): void {
    if (this.dirty) {
      scheduler.schedule()
    }
  }

  private requireCfb(): CFB.CFB$Container {
    if (!this.cfb) {
      throw new Error('HwpHolder is not loaded. Call load() first.')
    }

    return this.cfb
  }

  private getFileHeaderBuffer(cfb: CFB.CFB$Container): Buffer {
    const fileHeaderEntry = CFB.find(cfb, 'FileHeader')
    if (!fileHeaderEntry?.content) {
      throw new Error('Invalid HWP file: FileHeader not found')
    }

    return Buffer.from(fileHeaderEntry.content)
  }

  private serializeCfb(cfb: CFB.CFB$Container): Buffer {
    const output = CFB.write(cfb, { type: 'buffer' }) as Buffer | Uint8Array
    return Buffer.isBuffer(output) ? output : Buffer.from(output)
  }
}
