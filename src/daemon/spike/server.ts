import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'

const IDLE_MS = 2_000
const HOST = '127.0.0.1'

let idleTimer: ReturnType<typeof setTimeout>

function resetIdle() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => process.exit(0), IDLE_MS)
}

process.stderr.write(`argv0: ${process.argv0}\n`)

const server = createServer((socket) => {
  resetIdle()
  let buf = ''
  socket.on('data', (chunk) => {
    resetIdle()
    buf += chunk.toString('utf8')
    try {
      const parsed = JSON.parse(buf)
      buf = ''
      socket.write(JSON.stringify({ echo: parsed }))
    } catch {}
  })
  socket.on('close', resetIdle)
})

server.listen(0, HOST, async () => {
  const addr = server.address()
  if (!addr || typeof addr === 'string') process.exit(1)
  const file = `/tmp/spike-test-${process.pid}.json`
  await writeFile(file, JSON.stringify({ port: addr.port, pid: process.pid }))
  resetIdle()
})
