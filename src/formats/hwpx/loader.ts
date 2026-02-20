import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { PATHS, sectionPath } from './paths'

export type HwpxArchive = {
  getVersionXml(): Promise<string>
  getHeaderXml(): Promise<string>
  getSectionXml(n: number): Promise<string>
  getSectionCount(): number
  listBinData(): string[]
  getBinData(path: string): Promise<Buffer>
  getZip(): JSZip
}

export async function loadHwpx(filePath: string): Promise<HwpxArchive> {
  let fileBuffer: Buffer
  try {
    fileBuffer = await readFile(filePath)
  } catch (err) {
    throw new Error(`Failed to read file: ${filePath} — ${(err as Error).message}`)
  }

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(fileBuffer)
  } catch (err) {
    throw new Error(`Failed to parse HWPX file as ZIP: ${filePath} — ${(err as Error).message}`)
  }

  validateHwpx(zip, filePath)

  const sectionCount = countSections(zip)

  return {
    async getVersionXml(): Promise<string> {
      return getEntry(zip, PATHS.VERSION_XML)
    },
    async getHeaderXml(): Promise<string> {
      return getEntry(zip, PATHS.HEADER_XML)
    },
    async getSectionXml(n: number): Promise<string> {
      return getEntry(zip, sectionPath(n))
    },
    getSectionCount(): number {
      return sectionCount
    },
    listBinData(): string[] {
      return Object.keys(zip.files).filter((name) => name.startsWith(PATHS.BIN_DATA_DIR) && !zip.files[name].dir)
    },
    async getBinData(path: string): Promise<Buffer> {
      const entry = zip.file(path)
      if (!entry) throw new Error(`BinData entry not found: ${path}`)
      return entry.async('nodebuffer')
    },
    getZip(): JSZip {
      return zip
    },
  }
}

function validateHwpx(zip: JSZip, filePath: string): void {
  const required = [PATHS.HEADER_XML, PATHS.CONTENT_HPF]
  for (const path of required) {
    if (!zip.file(path)) {
      throw new Error(`Invalid HWPX file (${filePath}): missing required entry "${path}"`)
    }
  }
  if (!zip.file(sectionPath(0))) {
    throw new Error(`Invalid HWPX file (${filePath}): missing required entry "${sectionPath(0)}"`)
  }
}

function countSections(zip: JSZip): number {
  let count = 0
  while (zip.file(sectionPath(count))) {
    count++
  }
  return count
}

async function getEntry(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path)
  if (!entry) throw new Error(`HWPX entry not found: ${path}`)
  return entry.async('string')
}
