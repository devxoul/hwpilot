import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

export type StateFileData = {
  port: number
  token: string
  pid: number
  version: string
}

export function getStateFilePath(filePath: string): string {
  const resolvedPath = resolve(filePath)
  let realPath: string

  if (existsSync(resolvedPath)) {
    realPath = realpathSync(resolvedPath)
  } else {
    realPath = resolvedPath
  }

  const hash = createHash('sha256').update(realPath).digest('hex').slice(0, 16)
  return `${tmpdir()}/hwpclid-${hash}.json`
}

export function writeStateFile(filePath: string, data: StateFileData): void {
  const stateFilePath = getStateFilePath(filePath)
  const tmpPath = `${stateFilePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(data))
  renameSync(tmpPath, stateFilePath)
}

export function writeStateFileExclusive(filePath: string, data: StateFileData): void {
  const stateFilePath = getStateFilePath(filePath)
  writeFileSync(stateFilePath, JSON.stringify(data), { flag: 'wx' })
}

export function readStateFile(filePath: string): StateFileData | null {
  try {
    const stateFilePath = getStateFilePath(filePath)
    const content = readFileSync(stateFilePath, 'utf8')
    return JSON.parse(content) as StateFileData
  } catch {
    return null
  }
}

export function deleteStateFile(filePath: string): void {
  try {
    unlinkSync(getStateFilePath(filePath))
  } catch {
    // ignore ENOENT
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function generateToken(): string {
  return randomBytes(16).toString('hex')
}

export function getVersion(): string {
  const require = createRequire(import.meta.url)
  const pkg = require('../../package.json') as { version: string }
  return pkg.version
}
