import { readFile, writeFile } from 'node:fs/promises'

import CFB from 'cfb'

import type { EditOperation } from '@/shared/edit-types'

import { writeCfb } from './cfb-writer'
import { getEntryBuffer, mutateHwpCfb } from './mutator'
import { getCompressionFlag } from './stream-util'
import { validateHwpBuffer } from './validator'

export async function editHwp(filePath: string, operations: EditOperation[]): Promise<void> {
  if (operations.length === 0) {
    return
  }

  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const fileHeader = getEntryBuffer(cfb, '/FileHeader')
  const compressed = getCompressionFlag(fileHeader)

  mutateHwpCfb(cfb, operations, compressed)

  const buffer = writeCfb(cfb)

  const result = await validateHwpBuffer(buffer)
  if (!result.valid) {
    const failedChecks = result.checks.filter((c) => c.status === 'fail')
    const failedCheckText = failedChecks.map((c) => c.name + (c.message ? ': ' + c.message : '')).join('; ')
    throw new Error('HWP validation failed: ' + failedCheckText)
  }

  await writeFile(filePath, buffer)
}
