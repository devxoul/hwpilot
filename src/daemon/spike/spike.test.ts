import { describe, expect, it, afterEach } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { readFile, readdir, unlink } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'

const SERVER = join(import.meta.dir, 'server.ts')
const CLIENT = join(import.meta.dir, 'client.ts')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForFile(path: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as { port: number; pid: number }
    } catch {
      await sleep(100)
    }
  }
  throw new Error(`timeout: ${path}`)
}

// track spawned pids for cleanup
const pids: number[] = []
afterEach(() => {
  for (const pid of pids) {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
  pids.length = 0
})

describe('daemon spike', () => {
  it('detached child survives after client exits', async () => {
    // run client which spawns server, sends message, exits
    const proc = Bun.spawn([process.argv0, CLIENT], { stdout: 'pipe', stderr: 'pipe' })
    await proc.exited

    // find the spike file the server wrote
    const files = await readdir('/tmp')
    const spikeFiles = files.filter((f) => f.startsWith('spike-test-') && f.endsWith('.json'))
    expect(spikeFiles.length).toBeGreaterThan(0)

    const latest = spikeFiles.sort().pop()!
    const { pid } = await waitForFile(`/tmp/${latest}`)
    pids.push(pid)

    expect(pidAlive(pid)).toBe(true)
  }, 10_000)

  it('TCP round-trip echoes JSON', async () => {
    const server = spawn(process.argv0, [SERVER], { stdio: 'ignore' })
    pids.push(server.pid!)

    const portFile = `/tmp/spike-test-${server.pid}.json`
    const { port } = await waitForFile(portFile)

    const response = await new Promise<unknown>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port }, () => {
        socket.write(JSON.stringify({ hello: 'world' }))
      })
      socket.on('data', (chunk) => {
        resolve(JSON.parse(chunk.toString('utf8')))
        socket.end()
      })
      socket.on('error', reject)
    })

    expect(response).toEqual({ echo: { hello: 'world' } })
  }, 10_000)

  it('self-kills after idle timeout', async () => {
    const server = spawn(process.argv0, [SERVER], { stdio: 'ignore' })
    const pid = server.pid!
    pids.push(pid)

    const portFile = `/tmp/spike-test-${pid}.json`
    await waitForFile(portFile)

    expect(pidAlive(pid)).toBe(true)
    await sleep(3_000) // server idle timeout is 2s
    expect(pidAlive(pid)).toBe(false)

    // cleanup file
    try { await unlink(portFile) } catch {}
  }, 10_000)

  it('process.argv0 is a usable runtime', () => {
    const result = spawnSync(process.argv0, ['--version'])
    expect(result.status).toBe(0)
    const output = (result.stdout?.toString() || result.stderr?.toString() || '').trim()
    expect(output.length).toBeGreaterThan(0)
  })
})
