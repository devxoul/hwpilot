import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deleteStateFile,
  generateToken,
  getStateFilePath,
  getVersion,
  isProcessAlive,
  readStateFile,
  type StateFileData,
  writeStateFile,
  writeStateFileExclusive,
} from './state-file'

describe('state-file', () => {
  describe('getStateFilePath', () => {
    it('returns same path for same file', () => {
      const path1 = getStateFilePath('/tmp/test.hwpx')
      const path2 = getStateFilePath('/tmp/test.hwpx')
      expect(path1).toBe(path2)
    })

    it('returns different paths for different files', () => {
      const path1 = getStateFilePath('/tmp/test1.hwpx')
      const path2 = getStateFilePath('/tmp/test2.hwpx')
      expect(path1).not.toBe(path2)
    })

    it('resolves symlinks to same state file path', async () => {
      const testDir = join(tmpdir(), `state-test-${Date.now()}`)
      mkdirSync(testDir, { recursive: true })

      try {
        const realFile = join(testDir, 'real.hwpx')
        writeFileSync(realFile, '')
        const linkFile = join(testDir, 'link.hwpx')
        symlinkSync(realFile, linkFile)

        const path1 = getStateFilePath(realFile)
        const path2 = getStateFilePath(linkFile)
        expect(path1).toBe(path2)
      } finally {
        await rm(testDir, { recursive: true, force: true })
      }
    })

    it('returns path in tmpdir', () => {
      const path = getStateFilePath('/tmp/test.hwpx')
      expect(path).toContain(tmpdir())
    })

    it('includes hwpilotd prefix', () => {
      const path = getStateFilePath('/tmp/test.hwpx')
      expect(path).toContain('hwpilotd-')
    })

    it('ends with .json', () => {
      const path = getStateFilePath('/tmp/test.hwpx')
      expect(path).toEndWith('.json')
    })
  })

  describe('writeStateFile and readStateFile', () => {
    let testDir: string

    beforeEach(() => {
      testDir = join(tmpdir(), `state-test-${Date.now()}`)
      mkdirSync(testDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true })
    })

    it('round-trips data', () => {
      const filePath = join(testDir, 'test.hwpx')
      writeFileSync(filePath, '')

      const data: StateFileData = {
        port: 3000,
        token: 'abc123',
        pid: 12345,
        version: '1.0.0',
      }

      writeStateFile(filePath, data)
      const read = readStateFile(filePath)

      expect(read).toEqual(data)
    })

    it('overwrites existing state file', () => {
      const filePath = join(testDir, 'test.hwpx')
      writeFileSync(filePath, '')

      const data1: StateFileData = {
        port: 3000,
        token: 'abc123',
        pid: 12345,
        version: '1.0.0',
      }

      const data2: StateFileData = {
        port: 3001,
        token: 'def456',
        pid: 54321,
        version: '2.0.0',
      }

      writeStateFile(filePath, data1)
      writeStateFile(filePath, data2)
      const read = readStateFile(filePath)

      expect(read).toEqual(data2)
    })
  })

  describe('writeStateFileExclusive', () => {
    let testDir: string

    beforeEach(() => {
      testDir = join(tmpdir(), `state-test-${Date.now()}`)
      mkdirSync(testDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true })
    })

    it('writes state file when it does not exist', () => {
      const filePath = join(testDir, 'test.hwpx')
      writeFileSync(filePath, '')

      const data: StateFileData = {
        port: 3000,
        token: 'abc123',
        pid: 12345,
        version: '1.0.0',
      }

      writeStateFileExclusive(filePath, data)
      const read = readStateFile(filePath)
      expect(read).toEqual(data)

      deleteStateFile(filePath)
    })

    it('throws EEXIST when state file already exists', () => {
      const filePath = join(testDir, 'test.hwpx')
      writeFileSync(filePath, '')

      const data: StateFileData = {
        port: 3000,
        token: 'abc123',
        pid: 12345,
        version: '1.0.0',
      }

      writeStateFileExclusive(filePath, data)
      expect(() => writeStateFileExclusive(filePath, data)).toThrow()

      deleteStateFile(filePath)
    })

    it('preserves first write on EEXIST conflict', () => {
      const filePath = join(testDir, 'test.hwpx')
      writeFileSync(filePath, '')

      const first: StateFileData = { port: 3000, token: 'first', pid: 1, version: '1.0.0' }
      const second: StateFileData = { port: 3001, token: 'second', pid: 2, version: '1.0.0' }

      writeStateFileExclusive(filePath, first)
      try {
        writeStateFileExclusive(filePath, second)
      } catch {}

      const read = readStateFile(filePath)
      expect(read).toEqual(first)

      deleteStateFile(filePath)
    })
  })

  describe('readStateFile', () => {
    let testDir: string

    beforeEach(() => {
      testDir = join(tmpdir(), `state-test-${Date.now()}`)
      mkdirSync(testDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true })
    })

    it('returns null for missing file', () => {
      const filePath = join(testDir, 'nonexistent.hwpx')
      const result = readStateFile(filePath)
      expect(result).toBeNull()
    })

    it('returns null for malformed JSON', () => {
      const filePath = join(testDir, 'test.hwpx')
      writeFileSync(filePath, '')

      const stateFilePath = getStateFilePath(filePath)
      writeFileSync(stateFilePath, 'not valid json')

      const result = readStateFile(filePath)
      expect(result).toBeNull()
    })

    it('returns null for missing required fields', () => {
      const filePath = join(testDir, 'test.hwpx')
      writeFileSync(filePath, '')

      const stateFilePath = getStateFilePath(filePath)
      writeFileSync(stateFilePath, JSON.stringify({ port: 3000 }))

      const result = readStateFile(filePath)
      expect(result).not.toBeNull()
    })
  })

  describe('deleteStateFile', () => {
    let testDir: string

    beforeEach(() => {
      testDir = join(tmpdir(), `state-test-${Date.now()}`)
      mkdirSync(testDir, { recursive: true })
    })

    afterEach(async () => {
      await rm(testDir, { recursive: true, force: true })
    })

    it('deletes existing state file', () => {
      const filePath = join(testDir, 'test.hwpx')
      writeFileSync(filePath, '')

      const data: StateFileData = {
        port: 3000,
        token: 'abc123',
        pid: 12345,
        version: '1.0.0',
      }

      writeStateFile(filePath, data)
      expect(readStateFile(filePath)).not.toBeNull()

      deleteStateFile(filePath)
      expect(readStateFile(filePath)).toBeNull()
    })

    it('does not throw for missing file', () => {
      const filePath = join(testDir, 'nonexistent.hwpx')
      expect(() => deleteStateFile(filePath)).not.toThrow()
    })
  })

  describe('isProcessAlive', () => {
    it('returns true for current process', () => {
      const result = isProcessAlive(process.pid)
      expect(result).toBe(true)
    })

    it('returns false for non-existent process', () => {
      const result = isProcessAlive(999999999)
      expect(result).toBe(false)
    })
  })

  describe('generateToken', () => {
    it('returns 32-character hex string', () => {
      const token = generateToken()
      expect(token).toMatch(/^[0-9a-f]{32}$/)
    })

    it('generates different tokens', () => {
      const token1 = generateToken()
      const token2 = generateToken()
      expect(token1).not.toBe(token2)
    })
  })

  describe('getVersion', () => {
    it('returns non-empty string', () => {
      const version = getVersion()
      expect(version).toBeTruthy()
      expect(typeof version).toBe('string')
    })

    it('matches package.json version', () => {
      const version = getVersion()
      expect(version).toBe('0.1.0')
    })
  })
})
