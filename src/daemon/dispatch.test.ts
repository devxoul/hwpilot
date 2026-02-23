import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatchViaDaemon } from '@/daemon/dispatch'
import { killDaemon } from '@/daemon/launcher'
import { deleteStateFile, getVersion, writeStateFile } from '@/daemon/state-file'
import { createTestHwpx } from '@/test-helpers'

const tempDirs: string[] = []
const daemonFiles = new Set<string>()

afterEach(async () => {
  delete process.env.HWPCLI_NO_DAEMON

  for (const filePath of daemonFiles) {
    try {
      await killDaemon(filePath)
    } catch {}
    deleteStateFile(filePath)
  }
  daemonFiles.clear()

  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('dispatchViaDaemon', () => {
  test('returns null when HWPCLI_NO_DAEMON=1', async () => {
    process.env.HWPCLI_NO_DAEMON = '1'

    const filePath = await createTempHwpxFile(['No daemon'])

    const result = await dispatchViaDaemon(filePath, 'read', { ref: 's0.p0' })

    expect(result).toBeNull()
  })

  test('dispatches through daemon and returns response', async () => {
    const filePath = await createTempHwpxFile(['Hello daemon'])
    daemonFiles.add(filePath)

    const result = await dispatchViaDaemon(filePath, 'text', { ref: 's0.p0' })

    expect(result).not.toBeNull()
    expect(result).toEqual({ success: true, data: { ref: 's0.p0', text: 'Hello daemon' } })
  })

  test('retries once on ECONNREFUSED after deleting stale state', async () => {
    const filePath = await createTempHwpxFile(['Retry target'])
    daemonFiles.add(filePath)

    writeStateFile(filePath, {
      port: 1,
      token: 'stale-token',
      pid: process.pid,
      version: getVersion(),
    })

    const result = await dispatchViaDaemon(filePath, 'read', { ref: 's0.p0' })

    expect(result).not.toBeNull()
    expect(result?.success).toBe(true)
    if (result?.success) {
      expect(result.data).toMatchObject({ ref: 's0.p0' })
    }
  })
})

async function createTempHwpxFile(paragraphs: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dispatch-test-'))
  tempDirs.push(dir)

  const filePath = join(dir, 'fixture.hwpx')
  const buffer = await createTestHwpx({ paragraphs })
  await writeFile(filePath, buffer)
  return filePath
}
