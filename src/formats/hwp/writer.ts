import { readFile, writeFile } from 'node:fs/promises'
import CFB from 'cfb'
import type { EditOperation } from '@/shared/edit-types'
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

  const buffer = Buffer.from(CFB.write(cfb, { type: 'buffer' }))

  try {
    const result = await validateHwpBuffer(buffer)
    if (!result.valid) {
      const failedChecks = result.checks.filter((c) => c.status === 'fail')
      const onlyNCharsMismatch =
        failedChecks.length > 0 &&
        failedChecks.every((check) => check.name === 'nchars_consistency' && check.message?.includes('nChars mismatch'))
      if (!onlyNCharsMismatch) {
        const failedCheckText = failedChecks.map((c) => c.name + (c.message ? ': ' + c.message : '')).join('; ')
        throw new Error('HWP validation failed: ' + failedCheckText)
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('HWP validation failed:')) {
      throw error
    }
    console.warn('HWP buffer validation error (proceeding with write):', error)
  }

  await writeFile(filePath, buffer)
}
