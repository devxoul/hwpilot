#!/usr/bin/env bun
// Daemon entry point — started by launcher.ts
// Full implementation added in Task 11 (server.ts)
// For now: just exit to allow launcher tests to work

const filePath = process.argv[2]
if (!filePath) {
  process.stderr.write('Usage: entry.ts <file-path>\n')
  process.exit(1)
}

// Placeholder: Task 11 will replace this with startDaemonServer(filePath)
process.exit(0)
