import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { killDaemon } from '../src/daemon/launcher'
import { isProcessAlive, readStateFile } from '../src/daemon/state-file'
import { createTestHwpx } from '../src/test-helpers'

type CliResult = {
  stdout: string
  stderr: string
  exitCode: number
}

let hwpxFile: string
let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'daemon-lifecycle-'))
  hwpxFile = join(tempDir, 'test.hwpx')
  const buffer = await createTestHwpx({ paragraphs: ['Original text', 'Second paragraph'] })
  await writeFile(hwpxFile, buffer)
})

afterAll(async () => {
  await killDaemon(hwpxFile).catch(() => {})
  await rm(tempDir, { recursive: true, force: true })
})

afterEach(async () => {
  await killDaemon(hwpxFile).catch(() => {})
  // Restore original file
  const buffer = await createTestHwpx({ paragraphs: ['Original text', 'Second paragraph'] })
  await writeFile(hwpxFile, buffer)
})

async function runCliWithEnv(args: string[], envOverrides: Record<string, string | undefined>): Promise<CliResult> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key]
      continue
    }
    env[key] = value
  }

  const proc = Bun.spawn(['bun', 'src/cli.ts', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { stdout, stderr, exitCode }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('daemon lifecycle', () => {
  test('daemon auto-starts on first CLI call', async () => {
    const result = await runCliWithEnv(['read', hwpxFile, 's0'], {
      HWPCLI_NO_DAEMON: undefined,
      HWPCLI_DAEMON_IDLE_MS: '30000',
    })
    expect(result.exitCode).toBe(0)

    // Verify state file exists and PID is alive
    const state = readStateFile(hwpxFile)
    expect(state).not.toBeNull()
    expect(isProcessAlive(state!.pid)).toBe(true)
  })

  test('daemon shuts down after idle timeout', async () => {
    await runCliWithEnv(['read', hwpxFile, 's0'], {
      HWPCLI_NO_DAEMON: undefined,
      HWPCLI_DAEMON_IDLE_MS: '500',
    })

    const state = readStateFile(hwpxFile)
    expect(state).not.toBeNull()
    const pid = state!.pid

    // Wait for idle timeout + buffer
    await sleep(2000)

    // Verify daemon exited and state file cleaned
    expect(isProcessAlive(pid)).toBe(false)
    expect(readStateFile(hwpxFile)).toBeNull()
  })

  test('recovers from crashed daemon', async () => {
    // Start daemon
    await runCliWithEnv(['read', hwpxFile, 's0'], {
      HWPCLI_NO_DAEMON: undefined,
      HWPCLI_DAEMON_IDLE_MS: '30000',
    })
    const state = readStateFile(hwpxFile)!
    expect(state).not.toBeNull()

    // Kill daemon with SIGKILL (no graceful shutdown)
    process.kill(state.pid, 'SIGKILL')
    await sleep(200)

    // Run another command — should spawn new daemon
    const result = await runCliWithEnv(['read', hwpxFile, 's0'], {
      HWPCLI_NO_DAEMON: undefined,
      HWPCLI_DAEMON_IDLE_MS: '30000',
    })
    expect(result.exitCode).toBe(0)

    // New daemon running with different PID
    const newState = readStateFile(hwpxFile)
    expect(newState).not.toBeNull()
    expect(newState!.pid).not.toBe(state.pid)
    expect(isProcessAlive(newState!.pid)).toBe(true)
  })

  test('edits persist after daemon flush', async () => {
    // Edit via daemon with fast flush
    const editResult = await runCliWithEnv(['edit', 'text', hwpxFile, 's0.p0', 'LIFECYCLE-TEST'], {
      HWPCLI_NO_DAEMON: undefined,
      HWPCLI_DAEMON_IDLE_MS: '30000',
      HWPCLI_DAEMON_FLUSH_MS: '50',
    })
    expect(editResult.exitCode).toBe(0)

    // Wait for flush
    await sleep(300)

    // Kill daemon
    await killDaemon(hwpxFile)

    // Read file directly (no daemon) — edit should be persisted on disk
    const result = await runCliWithEnv(['text', hwpxFile, 's0.p0'], { HWPCLI_NO_DAEMON: '1' })
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.stdout) as { text: string }
    expect(data.text).toBe('LIFECYCLE-TEST')
  })

  test('graceful shutdown flushes and cleans state file', async () => {
    // Edit via daemon with long flush interval — SIGTERM should trigger immediate flush
    const editResult = await runCliWithEnv(['edit', 'text', hwpxFile, 's0.p0', 'GRACEFUL-SHUTDOWN'], {
      HWPCLI_NO_DAEMON: undefined,
      HWPCLI_DAEMON_IDLE_MS: '30000',
      HWPCLI_DAEMON_FLUSH_MS: '5000',
    })
    expect(editResult.exitCode).toBe(0)

    const state = readStateFile(hwpxFile)!
    expect(state).not.toBeNull()

    // Send SIGTERM for graceful shutdown
    process.kill(state.pid, 'SIGTERM')
    await sleep(1000)

    // State file should be cleaned
    expect(readStateFile(hwpxFile)).toBeNull()
    expect(isProcessAlive(state.pid)).toBe(false)

    // Edit should be persisted (SIGTERM triggers immediate flush)
    const result = await runCliWithEnv(['text', hwpxFile, 's0.p0'], { HWPCLI_NO_DAEMON: '1' })
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.stdout) as { text: string }
    expect(data.text).toBe('GRACEFUL-SHUTDOWN')
  })
})
