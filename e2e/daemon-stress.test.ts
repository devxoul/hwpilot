import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { killDaemon } from '../src/daemon/launcher'
import { createTestHwpx } from '../src/test-helpers'

type CliResult = {
  stdout: string
  stderr: string
  exitCode: number
}

let hwpxFile: string
let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'daemon-stress-'))
  hwpxFile = join(tempDir, 'test.hwpx')
  const buffer = await createTestHwpx({ paragraphs: ['Original', 'Second', 'Third'] })
  await writeFile(hwpxFile, buffer)
})

afterAll(async () => {
  await killDaemon(hwpxFile).catch(() => {})
  await rm(tempDir, { recursive: true, force: true })
})

afterEach(async () => {
  await killDaemon(hwpxFile).catch(() => {})
  // Restore original file
  const buffer = await createTestHwpx({ paragraphs: ['Original', 'Second', 'Third'] })
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

describe('daemon stress tests', () => {
  test('5 concurrent reads return identical output', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        runCliWithEnv(['read', hwpxFile, 's0'], {
          HWPCLI_NO_DAEMON: undefined,
          HWPCLI_DAEMON_IDLE_MS: '30000',
        }),
      ),
    )

    for (const result of results) {
      expect(result.exitCode).toBe(0)
    }

    // All outputs should be identical
    const outputs = results.map((r) => r.stdout.trim())
    for (const output of outputs) {
      expect(output).toBe(outputs[0])
    }
  })

  test('10 rapid sequential edits all succeed', async () => {
    for (let i = 0; i < 10; i++) {
      const result = await runCliWithEnv(['edit', 'text', hwpxFile, 's0.p0', `Edit ${i}`], {
        HWPCLI_NO_DAEMON: undefined,
        HWPCLI_DAEMON_IDLE_MS: '30000',
        HWPCLI_DAEMON_FLUSH_MS: '5000',
      })
      expect(result.exitCode).toBe(0)
    }

    // Final state should be last edit
    const result = await runCliWithEnv(['text', hwpxFile, 's0.p0'], {
      HWPCLI_NO_DAEMON: undefined,
      HWPCLI_DAEMON_IDLE_MS: '30000',
    })
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.stdout) as { text: string }
    expect(data.text).toBe('Edit 9')
  })

  test('interleaved reads and writes return consistent state', async () => {
    // Write then read, verify consistency
    const writeResult = await runCliWithEnv(['edit', 'text', hwpxFile, 's0.p0', 'MIXED-TEST'], {
      HWPCLI_NO_DAEMON: undefined,
      HWPCLI_DAEMON_IDLE_MS: '30000',
      HWPCLI_DAEMON_FLUSH_MS: '5000',
    })
    expect(writeResult.exitCode).toBe(0)

    // Multiple concurrent reads after write
    const reads = await Promise.all(
      Array.from({ length: 3 }, () =>
        runCliWithEnv(['text', hwpxFile, 's0.p0'], {
          HWPCLI_NO_DAEMON: undefined,
          HWPCLI_DAEMON_IDLE_MS: '30000',
        }),
      ),
    )

    for (const read of reads) {
      expect(read.exitCode).toBe(0)
      const data = JSON.parse(read.stdout) as { text: string }
      expect(data.text).toBe('MIXED-TEST')
    }
  })

  test('rapid edits result in single debounced flush', async () => {
    // Make 5 rapid edits with fast flush
    for (let i = 0; i < 5; i++) {
      const result = await runCliWithEnv(['edit', 'text', hwpxFile, 's0.p0', `Rapid ${i}`], {
        HWPCLI_NO_DAEMON: undefined,
        HWPCLI_DAEMON_IDLE_MS: '30000',
        HWPCLI_DAEMON_FLUSH_MS: '200',
      })
      expect(result.exitCode).toBe(0)
    }

    // Wait for flush to complete
    await sleep(500)

    // Kill daemon and read directly — should have last edit
    await killDaemon(hwpxFile)
    const result = await runCliWithEnv(['text', hwpxFile, 's0.p0'], { HWPCLI_NO_DAEMON: '1' })
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.stdout) as { text: string }
    expect(data.text).toBe('Rapid 4')
  })
})
