import { validateHwp } from '@/formats/hwp/validator'
import { handleError } from '@/shared/error-handler'
import { formatOutput } from '@/shared/output'

type ValidateOptions = {
  pretty?: boolean
}

export async function validateCommand(file: string, options: ValidateOptions): Promise<void> {
  try {
    const result = await validateHwp(file)
    process.stdout.write(formatOutput(result, options.pretty) + '\n')
    if (!result.valid) {
      process.exit(1)
    }
  } catch (e) {
    handleError(e)
  }
}
