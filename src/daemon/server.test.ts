import { afterEach, describe, expect, test } from 'bun:test'
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadHwpx } from '../formats/hwpx/loader'
import { parseSections } from '../formats/hwpx/section-parser'
import { createTestHwpx } from '../test-helpers'
import { sendRequest } from './client'
import { deleteStateFile, readStateFile } from './state-file'

type StartedDaemon = {
  child: ChildProcess
  port: number
  token: string
  filePath: string
  stop(): Promise<void>
}

const tempDirs: string[] = []
const daemons: StartedDaemon[] = []

afterEach(async () => {
  for (const daemon of daemons.splice(0)) {
    await daemon.stop()
  }

  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('daemon server', () => {
  test('starts and handles read request with valid token', async () => {
    const filePath = await createTempHwpxFile(['Hello daemon'])
    const daemon = await startTestDaemon(filePath, {
      HWPCLI_DAEMON_IDLE_MS: '5000',
      HWPCLI_DAEMON_FLUSH_MS: '100',
    })

    const response = await sendRequest(daemon.port, daemon.token, {
      command: 'read',
      args: { ref: 's0.p0' },
    })

    expect(response.success).toBe(true)
    if (response.success) {
      expect(response.data).toMatchObject({
        ref: 's0.p0',
        runs: [{ text: 'Hello daemon', charShapeRef: 0 }],
      })
    }
  })

  test('rejects invalid token', async () => {
    const filePath = await createTempHwpxFile(['Token check'])
    const daemon = await startTestDaemon(filePath, {
      HWPCLI_DAEMON_IDLE_MS: '5000',
      HWPCLI_DAEMON_FLUSH_MS: '100',
    })

    const response = await sendRequest(daemon.port, 'invalid-token', {
      command: 'read',
      args: { ref: 's0.p0' },
    })

    expect(response.success).toBe(false)
    if (!response.success) {
      expect(response.error).toBe('Unauthorized: invalid token')
    }
  })

  test('shuts down after idle timeout', async () => {
    const filePath = await createTempHwpxFile(['Idle timeout'])
    const daemon = await startTestDaemon(filePath, {
      HWPCLI_DAEMON_IDLE_MS: '250',
      HWPCLI_DAEMON_FLUSH_MS: '100',
    })

    const exitCode = await waitForExit(daemon.child, 4000)
    expect(exitCode).toBe(0)
    expect(readStateFile(filePath)).toBeNull()

    removeDaemon(daemon)
  })

  test('persists edit changes after flush', async () => {
    const filePath = await createTempHwpxFile(['Before'])
    const daemon = await startTestDaemon(filePath, {
      HWPCLI_DAEMON_IDLE_MS: '10000',
      HWPCLI_DAEMON_FLUSH_MS: '50',
    })

    const response = await sendRequest(daemon.port, daemon.token, {
      command: 'edit-text',
      args: { ref: 's0.p0', text: 'After' },
    })

    expect(response).toEqual({
      success: true,
      data: { ref: 's0.p0', text: 'After', success: true },
    })

    await sleep(200)
    await daemon.stop()
    removeDaemon(daemon)

    const archive = await loadHwpx(filePath)
    const sections = await parseSections(archive)
    expect(sections[0]?.paragraphs[0]?.runs[0]?.text).toBe('After')
  })
})

async function createTempHwpxFile(paragraphs: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'daemon-server-test-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'fixture.hwpx')
  const buffer = await createTestHwpx({ paragraphs })
  await writeFile(filePath, buffer)
  return filePath
}

async function startTestDaemon(filePath: string, envOverrides: Record<string, string>): Promise<StartedDaemon> {
  const entryScript = join(process.cwd(), 'src/daemon/entry.ts')
  const child = spawn(process.argv0, [entryScript, filePath], {
    env: { ...process.env, ...envOverrides },
    stdio: 'pipe',
  })

  child.on('error', () => {})

  const state = await waitForStateFile(filePath, 5000)
  const daemon: StartedDaemon = {
    child,
    port: state.port,
    token: state.token,
    filePath,
    async stop() {
      if (child.exitCode !== null || child.killed) {
        deleteStateFile(filePath)
        return
      }

      child.kill('SIGTERM')
      await waitForExit(child, 4000)
      deleteStateFile(filePath)
    },
  }

  daemons.push(daemon)
  return daemon
}

async function waitForStateFile(filePath: string, timeoutMs: number) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const state = readStateFile(filePath)
    if (state) {
      return state
    }
    await sleep(50)
  }

  throw new Error(`Daemon failed to start for ${filePath}`)
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for daemon process ${child.pid} to exit`))
    }, timeoutMs)

    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })
}

function removeDaemon(daemon: StartedDaemon): void {
  const index = daemons.indexOf(daemon)
  if (index >= 0) {
    daemons.splice(index, 1)
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
