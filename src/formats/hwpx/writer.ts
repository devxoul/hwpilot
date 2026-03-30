import { readFile, writeFile } from 'node:fs/promises'

import { type EditOperation, type FormatOptions, type XmlNode } from '@/sdk/edit-types'
import { editHwpx as sdkEditHwpx } from '@/sdk/formats/hwpx/writer'

export type { EditOperation, FormatOptions, XmlNode }

export async function editHwpx(filePath: string, operations: EditOperation[]): Promise<void> {
  if (operations.length === 0) {
    return
  }

  const buffer = await readFile(filePath)
  const result = await sdkEditHwpx(new Uint8Array(buffer), operations)
  await writeFile(filePath, Buffer.from(result))
}
