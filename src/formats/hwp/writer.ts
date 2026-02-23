import { readFile, writeFile } from 'node:fs/promises'
import CFB from 'cfb'
import type { EditOperation } from '@/shared/edit-types'
import { getCompressionFlag } from './stream-util'
import { mutateHwpCfb, getEntryBuffer } from './mutator'

export async function editHwp(filePath: string, operations: EditOperation[]): Promise<void> {
  if (operations.length === 0) {
    return
  }

  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const fileHeader = getEntryBuffer(cfb, '/FileHeader')
  const compressed = getCompressionFlag(fileHeader)

  mutateHwpCfb(cfb, operations, compressed)

  await writeFile(filePath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
}
