import { readFile, writeFile } from 'node:fs/promises'

import type { EditOperation } from '@/sdk/edit-types'
import { editHwp as sdkEditHwp } from '@/sdk/formats/hwp/writer'

export async function editHwp(filePath: string, operations: EditOperation[]): Promise<void> {
  if (operations.length === 0) {
    return
  }

  const buffer = await readFile(filePath)
  const result = await sdkEditHwp(new Uint8Array(buffer), operations)
  await writeFile(filePath, Buffer.from(result))
}
