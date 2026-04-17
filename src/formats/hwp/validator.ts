import { readFile } from 'node:fs/promises'

import {
  validateHwp as sdkValidateHwp,
  validateHwpBuffer,
  type ValidateResult,
  type CheckResult,
  type CheckStatus,
  type ValidateHwpOptions,
} from '@/sdk/formats/hwp/validator'

export type { ValidateResult, CheckResult, CheckStatus, ValidateHwpOptions }
export { validateHwpBuffer }

export async function validateHwp(filePath: string, options: ValidateHwpOptions = {}): Promise<ValidateResult> {
  const buffer = await readFile(filePath)
  const result = await sdkValidateHwp(buffer, options)
  result.file = filePath
  return result
}
