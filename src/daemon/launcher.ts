import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deleteStateFile, getVersion, isProcessAlive, readStateFile } from '@/daemon/state-file'

export async function ensureDaemon(filePath: string): Promise<{ port: number; token: string }> {
  const resolvedPath = resolvePath(filePath)

  const existing = readStateFile(resolvedPath)
  if (existing) {
    if (!isProcessAlive(existing.pid)) {
      deleteStateFile(resolvedPath)
    } else if (existing.version !== getVersion()) {
      try {
        process.kill(existing.pid, 'SIGTERM')
      } catch {}
      deleteStateFile(resolvedPath)
    } else {
      return { port: existing.port, token: existing.token }
    }
  }

  const entryScript = getEntryScript()
  const child = spawn(process.argv0, [entryScript, resolvedPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  const MAX_ATTEMPTS = 100
  const POLL_INTERVAL_MS = 100
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS)
    const state = readStateFile(resolvedPath)
    // PID may differ from spawned child if another daemon won the race
    if (state && isProcessAlive(state.pid)) {
      return { port: state.port, token: state.token }
    }
  }

  throw new Error(`Daemon failed to start within ${(MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s for ${resolvedPath}`)
}

export async function killDaemon(filePath: string): Promise<void> {
  const resolvedPath = resolvePath(filePath)

  const state = readStateFile(resolvedPath)
  if (!state) return

  try {
    process.kill(state.pid, 'SIGTERM')
  } catch {
    // PID already dead — nothing to signal
  }

  const MAX_WAIT_MS = 5000
  const POLL_MS = 100
  let waited = 0
  while (waited < MAX_WAIT_MS && isProcessAlive(state.pid)) {
    await sleep(POLL_MS)
    waited += POLL_MS
  }

  deleteStateFile(resolvedPath)
}

function getEntryScript(): string {
  const dir = fileURLToPath(new URL('.', import.meta.url))
  const tsPath = join(dir, 'entry.ts')
  if (existsSync(tsPath)) return tsPath
  return join(dir, 'entry.js')
}

function resolvePath(filePath: string): string {
  const absPath = resolve(filePath)
  try {
    return realpathSync(absPath)
  } catch {
    return absPath
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
