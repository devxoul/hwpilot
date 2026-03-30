import { readFile, writeFile } from 'node:fs/promises'

import { detectFormat } from '@/sdk/format-detector'
import { loadHwp } from '@/sdk/formats/hwp/reader'
import { editHwp } from '@/sdk/formats/hwp/writer'
import { createHwp, type CreateHwpOptions } from '@/sdk/formats/hwp/creator'
import { parseHeader } from '@/sdk/formats/hwpx/header-parser'
import { loadHwpx } from '@/sdk/formats/hwpx/loader'
import { editHwpx } from '@/sdk/formats/hwpx/writer'
import { parseSections } from '@/sdk/formats/hwpx/section-parser'
import type { EditOperation } from '@/sdk/edit-types'
import type { HwpDocument } from '@/sdk/types'

export async function openFile(filePath: string): Promise<HwpDocument> {
  const buffer = await readFile(filePath)
  const bytes = new Uint8Array(buffer)
  const format = detectFormat(bytes)

  if (format === 'hwp') {
    return loadHwp(bytes)
  }

  const archive = await loadHwpx(bytes)
  const header = parseHeader(await archive.getHeaderXml())
  const sections = await parseSections(archive)
  return { format: 'hwpx', sections, header }
}

export async function editFile(filePath: string, operations: EditOperation[]): Promise<void> {
  const buffer = await readFile(filePath)
  const bytes = new Uint8Array(buffer)
  const format = detectFormat(bytes)

  let result: Uint8Array
  if (format === 'hwp') {
    result = await editHwp(bytes, operations)
  } else {
    result = await editHwpx(bytes, operations)
  }

  await writeFile(filePath, Buffer.from(result))
}

export async function createHwpFile(filePath: string, options?: CreateHwpOptions): Promise<void> {
  const buffer = await createHwp(options)
  await writeFile(filePath, buffer)
}

export async function createHwpxFile(filePath: string, _options?: { font?: string; fontSize?: number }): Promise<void> {
  void _options
  throw new Error('createHwpxFile not implemented yet')
}
