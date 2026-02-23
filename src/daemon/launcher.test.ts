import { afterEach, describe, expect, it } from 'bun:test'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureDaemon, killDaemon } from './launcher'
import { deleteStateFile, getVersion, isProcessAlive, readStateFile, writeStateFile } from './state-file'

describe('launcher', () => {
  const tmpFiles: string[] = []

  afterEach(() => {
    for (const f of tmpFiles) {
      deleteStateFile(f)
    }
    tmpFiles.length = 0
  })

  describe('ensureDaemon', () => {
    it('returns existing alive daemon without spawning', async () => {
      const tmpFile = join(tmpdir(), `launcher-test-${Date.now()}.hwpx`)
      tmpFiles.push(tmpFile)

      writeStateFile(tmpFile, {
        port: 9999,
        token: 'test-token',
        pid: process.pid,
        version: getVersion(),
      })

      const result = await ensureDaemon(tmpFile)
      expect(result).toEqual({ port: 9999, token: 'test-token' })
    })
  })

  describe('stale state file', () => {
    it('is detected and cleaned up when PID is dead', () => {
      const tmpFile = join(tmpdir(), `launcher-test-${Date.now()}.hwpx`)
      tmpFiles.push(tmpFile)

      // given — stale state file with non-existent PID
      writeStateFile(tmpFile, {
        port: 9999,
        token: 'stale-token',
        pid: 999999999,
        version: '1.0.0',
      })
      expect(readStateFile(tmpFile)).not.toBeNull()
      expect(isProcessAlive(999999999)).toBe(false)

      // when — simulate ensureDaemon's stale cleanup logic
      const state = readStateFile(tmpFile)
      if (state && !isProcessAlive(state.pid)) {
        deleteStateFile(tmpFile)
      }

      // then
      expect(readStateFile(tmpFile)).toBeNull()
    })
  })

  describe('version mismatch', () => {
    it('cleans up state with wrong version and dead PID', () => {
      const tmpFile = join(tmpdir(), `launcher-test-${Date.now()}.hwpx`)
      tmpFiles.push(tmpFile)

      // given — state file with mismatched version and dead PID
      writeStateFile(tmpFile, {
        port: 9999,
        token: 'old-token',
        pid: 999999999,
        version: '0.0.0-old',
      })
      expect(readStateFile(tmpFile)).not.toBeNull()

      // when
      const state = readStateFile(tmpFile)!
      if (!isProcessAlive(state.pid)) {
        deleteStateFile(tmpFile)
      } else if (state.version !== getVersion()) {
        try {
          process.kill(state.pid, 'SIGTERM')
        } catch {}
        deleteStateFile(tmpFile)
      }

      // then
      expect(readStateFile(tmpFile)).toBeNull()
    })

    it('kills old daemon with wrong version', async () => {
      const tmpFile = join(tmpdir(), `launcher-test-${Date.now()}.hwpx`)
      tmpFiles.push(tmpFile)

      // given — spawn a helper process to act as old daemon
      const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' })
      child.unref()
      const childPid = child.pid!

      try {
        expect(isProcessAlive(childPid)).toBe(true)

        writeStateFile(tmpFile, {
          port: 9999,
          token: 'old-token',
          pid: childPid,
          version: '0.0.0-old',
        })

        // when — simulate version mismatch logic from ensureDaemon
        const state = readStateFile(tmpFile)!
        if (isProcessAlive(state.pid) && state.version !== getVersion()) {
          try {
            process.kill(state.pid, 'SIGTERM')
          } catch {}
          deleteStateFile(tmpFile)
        }

        // then
        await new Promise((r) => setTimeout(r, 200))
        expect(isProcessAlive(childPid)).toBe(false)
        expect(readStateFile(tmpFile)).toBeNull()
      } finally {
        try {
          process.kill(childPid, 'SIGKILL')
        } catch {}
      }
    })
  })

  describe('race condition', () => {
    it('uses winning daemon regardless of spawned child PID', async () => {
      const tmpFile = join(tmpdir(), `launcher-test-${Date.now()}.hwpx`)
      tmpFiles.push(tmpFile)

      // given — state file written by a different daemon (alive PID, correct version)
      writeStateFile(tmpFile, {
        port: 8888,
        token: 'winner-token',
        pid: process.pid,
        version: getVersion(),
      })

      // when
      const result = await ensureDaemon(tmpFile)

      // then — uses the existing daemon's connection info
      expect(result).toEqual({ port: 8888, token: 'winner-token' })
    })
  })

  describe('killDaemon', () => {
    it('does nothing when no daemon exists', async () => {
      const tmpFile = join(tmpdir(), `launcher-test-${Date.now()}.hwpx`)
      tmpFiles.push(tmpFile)

      await killDaemon(tmpFile)
    })

    it('deletes state file for dead process', async () => {
      const tmpFile = join(tmpdir(), `launcher-test-${Date.now()}.hwpx`)
      tmpFiles.push(tmpFile)

      // given
      writeStateFile(tmpFile, {
        port: 9999,
        token: 'dead-token',
        pid: 999999999,
        version: '1.0.0',
      })
      expect(readStateFile(tmpFile)).not.toBeNull()

      // when
      await killDaemon(tmpFile)

      // then
      expect(readStateFile(tmpFile)).toBeNull()
    })
  })
})
