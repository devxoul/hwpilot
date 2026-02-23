import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'

const serverScript = join(import.meta.dir, 'server.ts')
const child = spawn(process.argv0, [serverScript], {
  detached: true,
  stdio: 'ignore',
})
child.unref()

const portFile = `/tmp/spike-test-${child.pid}.json`

async function poll(file: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as { port: number; pid: number }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('timeout waiting for port file')
}

const { port } = await poll(portFile)

await new Promise<void>((resolve, reject) => {
  const socket = createConnection({ host: '127.0.0.1', port }, () => {
    socket.write(JSON.stringify({ hello: 'world' }))
  })
  socket.on('data', (chunk) => {
    process.stdout.write(chunk.toString('utf8'))
    socket.end()
  })
  socket.on('end', resolve)
  socket.on('error', reject)
})
