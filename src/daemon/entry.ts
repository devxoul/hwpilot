#!/usr/bin/env bun
import { startDaemonServer } from '@/daemon/server'

const filePath = process.argv[2]
if (!filePath) {
  process.stderr.write('Usage: entry.ts <file-path>\n')
  process.exit(1)
}

startDaemonServer(filePath).catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`)
  process.exit(1)
})
