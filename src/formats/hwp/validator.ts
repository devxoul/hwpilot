import { readFile } from 'node:fs/promises'

import { validateHwp as sdkValidateHwp, validateHwpBuffer, type ValidateResult, type CheckResult, type CheckStatus } from '@/sdk/formats/hwp/validator'

export type { ValidateResult, CheckResult, CheckStatus }
export { validateHwpBuffer }

export async function validateHwp(filePath: string): Promise<ValidateResult> {
  const buffer = await readFile(filePath)
  const result = await sdkValidateHwp(buffer)
  result.file = filePath
  return result
}
