import type { CheckResult } from '@/formats/hwp/validator'
import { validateHwp } from '@/formats/hwp/validator'
import { handleError } from '@/shared/error-handler'
import { formatOutput } from '@/shared/output'
import { checkViewerCorruption } from '@/shared/viewer'

type ValidateOptions = {
  pretty?: boolean
  viewer?: boolean
}

export async function validateCommand(file: string, options: ValidateOptions): Promise<void> {
  try {
    const result = await validateHwp(file)

    if (options.viewer) {
      const viewerCheck = await runViewerCheck(file)
      result.checks.push(viewerCheck)
      result.valid = result.checks.every((c) => c.status !== 'fail')
    }

    process.stdout.write(formatOutput(result, options.pretty) + '\n')
    if (!result.valid) {
      process.exit(1)
    }
  } catch (e) {
    handleError(e)
  }
}

async function runViewerCheck(filePath: string): Promise<CheckResult> {
  const result = await checkViewerCorruption(filePath)
  if (result.skipped) {
    return { name: 'viewer', status: 'skip', message: 'Hancom Office HWP Viewer not found' }
  }
  if (result.corrupted) {
    return {
      name: 'viewer',
      status: 'fail',
      message: 'Hancom Office HWP Viewer detected corruption',
      details: result.alert ? { alert: result.alert } : undefined,
    }
  }
  return { name: 'viewer', status: 'pass' }
}
