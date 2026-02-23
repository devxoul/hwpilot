import { afterEach, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureDaemon, killDaemon } from './launcher'
import { deleteStateFile, isProcessAlive, readStateFile, writeStateFile } from './state-file'

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
        version: '1.0.0',
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
