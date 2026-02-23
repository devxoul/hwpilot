import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { killDaemon } from '../src/daemon/launcher'
import { createTestHwpx } from '../src/test-helpers'

type CliResult = {
  stdout: string
  stderr: string
  exitCode: number
}

const HWP_FIXTURE = 'e2e/fixtures/피해자_의견_진술서_양식.hwp'
const HWP_FIND_QUERY = '피해자'
const HWPX_FIND_QUERY = 'Hello'
const EDIT_TEXT_VALUE = 'DAEMON IDENTITY TEXT'

let tempDir = ''
let hwpxFile = ''
const daemonFiles = new Set<string>()

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'daemon-identity-'))
  hwpxFile = join(tempDir, 'identity.hwpx')

  const hwpx = await createTestHwpx({
    paragraphs: ['Hello', 'World', '안녕하세요'],
    tables: [
      {
        rows: [
          ['t00', 't01'],
          ['t10', 't11'],
        ],
      },
    ],
    images: [
      {
        name: 'one-pixel',
        format: 'png',
        data: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5hFxoAAAAASUVORK5CYII=',
          'base64',
        ),
      },
    ],
  })

  await writeFile(hwpxFile, hwpx)
})

afterAll(async () => {
  for (const filePath of daemonFiles) {
    await killDaemon(filePath).catch(() => {})
  }

  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

describe('daemon output identity: direct mode vs daemon mode', () => {
  describe('HWPX', () => {
    test('read output is identical', async () => {
      await assertOutputIdentity(['read', hwpxFile, 's0'])
    })

    test('text output is identical', async () => {
      await assertOutputIdentity(['text', hwpxFile, '--limit', '5'])
    })

    test('find output is identical', async () => {
      await assertOutputIdentity(['find', hwpxFile, HWPX_FIND_QUERY, '--json'])
    })

    test('table list output is identical', async () => {
      await assertOutputIdentity(['table', 'list', hwpxFile])
    })

    test('image list output is identical', async () => {
      await assertOutputIdentity(['image', 'list', hwpxFile])
    })

    test('edit text output and persisted state are identical', async () => {
      await assertWriteIdentity(hwpxFile, (filePath) => ['edit', 'text', filePath, 's0.p0', EDIT_TEXT_VALUE])
    })

    test('edit format output and persisted state are identical', async () => {
      await assertWriteIdentity(hwpxFile, (filePath) => ['edit', 'format', filePath, 's0.p0', '--bold'])
    })
  })

  describe('HWP', () => {
    test('read output is identical', async () => {
      await assertOutputIdentity(['read', HWP_FIXTURE, 's0'])
    })

    test('text output is identical', async () => {
      await assertOutputIdentity(['text', HWP_FIXTURE, '--limit', '5'])
    })

    test('find output is identical', async () => {
      await assertOutputIdentity(['find', HWP_FIXTURE, HWP_FIND_QUERY, '--json'])
    })

    test('table list output is identical', async () => {
      await assertOutputIdentity(['table', 'list', HWP_FIXTURE])
    })

    test('image list output is identical', async () => {
      await assertOutputIdentity(['image', 'list', HWP_FIXTURE])
    })

    test('edit text output and persisted state are identical', async () => {
      await assertWriteIdentity(HWP_FIXTURE, (filePath) => ['edit', 'text', filePath, 's0.p0', EDIT_TEXT_VALUE])
    })

    test('edit format output and persisted state are identical', async () => {
      await assertWriteIdentity(HWP_FIXTURE, (filePath) => ['edit', 'format', filePath, 's0.p0', '--bold'])
    })
  })
})

async function assertOutputIdentity(args: string[]): Promise<void> {
  const targetFile = extractTargetFile(args)
  daemonFiles.add(resolve(targetFile))

  const [direct, daemon] = await Promise.all([runCliDirect(args), runCliDaemon(args)])

  assertSuccess(direct, args)
  assertSuccess(daemon, args)
  expect(daemon.stdout).toBe(direct.stdout)
}

async function assertWriteIdentity(sourceFile: string, argsFor: (filePath: string) => string[]): Promise<void> {
  const directFile = await copyToTemp(sourceFile, 'direct')
  const daemonFile = await copyToTemp(sourceFile, 'daemon')
  daemonFiles.add(resolve(daemonFile))

  const directArgs = argsFor(directFile)
  const daemonArgs = argsFor(daemonFile)

  const [directWrite, daemonWrite] = await Promise.all([runCliDirect(directArgs), runCliDaemon(daemonArgs)])
  assertSuccess(directWrite, directArgs)
  assertSuccess(daemonWrite, daemonArgs)
  expect(daemonWrite.stdout).toBe(directWrite.stdout)

  await Bun.sleep(150)

  const directRead = await runCliDirect(['read', directFile, 's0.p0'])
  const daemonRead = await runCliDaemon(['read', daemonFile, 's0.p0'])
  const daemonDiskRead = await runCliDirect(['read', daemonFile, 's0.p0'])

  assertSuccess(directRead, ['read', directFile, 's0.p0'])
  assertSuccess(daemonRead, ['read', daemonFile, 's0.p0'])
  assertSuccess(daemonDiskRead, ['read', daemonFile, 's0.p0'])

  expect(daemonRead.stdout).toBe(directRead.stdout)
  expect(daemonDiskRead.stdout).toBe(daemonRead.stdout)
}

async function copyToTemp(sourceFile: string, suffix: string): Promise<string> {
  const extension = sourceFile.endsWith('.hwpx') ? '.hwpx' : '.hwp'
  const copyPath = join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${suffix}${extension}`)
  await cp(sourceFile, copyPath)
  return copyPath
}

async function runCliDirect(args: string[]): Promise<CliResult> {
  return runCliWithEnv(args, { HWPCLI_NO_DAEMON: '1' })
}

async function runCliDaemon(args: string[]): Promise<CliResult> {
  return runCliWithEnv(args, {
    HWPCLI_NO_DAEMON: undefined,
    HWPCLI_DAEMON_FLUSH_MS: '50',
  })
}

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

function assertSuccess(result: CliResult, args: string[]): void {
  if (result.exitCode === 0) {
    return
  }
  throw new Error(`CLI failed (${args.join(' ')}): ${result.stderr}`)
}

function extractTargetFile(args: string[]): string {
  if (args[0] === 'edit') {
    return args[2]
  }
  if (args[0] === 'table' || args[0] === 'image') {
    return args[2]
  }
  return args[1]
}
