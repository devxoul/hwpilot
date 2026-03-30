import CFB from 'cfb'

import type { EditOperation } from '@/sdk/edit-types'

import { writeCfb } from './cfb-writer'
import { getEntryBuffer, mutateHwpCfb } from './mutator'
import { getCompressionFlag } from './stream-util'
import { validateHwpBuffer } from './validator'

export async function editHwp(fileBuffer: Uint8Array, operations: EditOperation[]): Promise<Uint8Array> {
  if (operations.length === 0) {
    return fileBuffer
  }

  const cfb = CFB.read(Buffer.from(fileBuffer), { type: 'buffer' })
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

  return new Uint8Array(buffer)
}
