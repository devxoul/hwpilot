import { sendRequest } from '@/daemon/client'
import { ensureDaemon } from '@/daemon/launcher'
import type { DaemonResponse } from '@/daemon/protocol'
import { deleteStateFile } from '@/daemon/state-file'

export async function dispatchViaDaemon(
  filePath: string,
  command: string,
  args: Record<string, unknown>,
): Promise<DaemonResponse | null> {
  if (process.env.HWPCLI_NO_DAEMON === '1') {
    return null
  }

  const { port, token } = await ensureDaemon(filePath)

  try {
    return await sendRequest(port, token, { command, args })
  } catch (error) {
    if (!isConnectionRefused(error)) {
      throw error
    }

    deleteStateFile(filePath)
    const { port: retryPort, token: retryToken } = await ensureDaemon(filePath)
    return sendRequest(retryPort, retryToken, { command, args })
  }
}

function isConnectionRefused(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return error.message.includes('ECONNREFUSED')
}
