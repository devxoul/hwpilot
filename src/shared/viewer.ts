import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const VIEWER_APP_NAME = 'Hancom Office HWP Viewer'
const VIEWER_ALERT_TIMEOUT_MS = 3000

export type ViewerCheckResult = {
  corrupted: boolean
  alert?: string
  skipped: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runCommand(cmd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.on('close', (code) => {
      resolve({ stdout, exitCode: code ?? 0 })
    })
    proc.on('error', () => {
      resolve({ stdout: '', exitCode: 1 })
    })
  })
}

export async function isHwpViewerAvailable(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  const result = await runCommand('mdfind', ['kMDItemCFBundleIdentifier == "com.haansoft.HancomOfficeViewer.Mac"'])
  if (result.stdout.trim().length > 0) return true
  return existsSync('/Applications/Hancom Office HWP Viewer.app')
}

export async function checkViewerCorruption(filePath: string): Promise<ViewerCheckResult> {
  const available = await isHwpViewerAvailable()
  if (!available) {
    return { corrupted: false, skipped: true }
  }

  // Snapshot existing PIDs
  const existingPidsResult = await runCommand('pgrep', ['-f', VIEWER_APP_NAME])
  const existingPids = new Set(existingPidsResult.stdout.trim().split('\n').filter(Boolean))

  // Open with OS-level hiding
  await runCommand('open', ['-g', '-j', '-a', VIEWER_APP_NAME, filePath])

  // Continuously force-hide the process (catches alerts that bypass -g -j)
  const keepHiddenScript = `
repeat 100 times
  delay 0.1
  tell application "System Events"
    if exists process "${VIEWER_APP_NAME}" then
      set visible of process "${VIEWER_APP_NAME}" to false
    end if
  end tell
end repeat
`
  const hideProc = spawn('osascript', ['-e', keepHiddenScript], { stdio: 'ignore' })

  // Wait for app to initialize (hide loop runs concurrently)
  await sleep(VIEWER_ALERT_TIMEOUT_MS)

  // Read alert via osascript with timeout
  const alertText = await readViewerAlert()

  // Stop continuous hiding
  hideProc.kill()

  // Check for corruption keywords
  const corrupted = alertText.includes('손상') || alertText.includes('변조') || alertText.includes('복구')

  // Quit viewer
  await runCommand('osascript', ['-e', `tell application "${VIEWER_APP_NAME}" to quit`])

  // Kill stray processes
  await sleep(2000)
  const strayPidsResult = await runCommand('pgrep', ['-f', VIEWER_APP_NAME])
  const strayPids = strayPidsResult.stdout.trim().split('\n').filter(Boolean)
  for (const pid of strayPids) {
    if (!existingPids.has(pid)) {
      await runCommand('kill', [pid])
    }
  }

  return { corrupted, alert: alertText || undefined, skipped: false }
}

async function readViewerAlert(): Promise<string> {
  const script = `
tell application "System Events"
  tell process "Hancom Office HWP Viewer"
    set winCount to count of windows
    if winCount > 1 then
      set alertText to ""
      repeat with w in windows
        try
          set texts to value of static texts of w
          repeat with t in texts
            set alertText to alertText & t
          end repeat
        end try
      end repeat
      return alertText
    end if
    return ""
  end tell
end tell
`

  return new Promise((resolve) => {
    const proc = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    const timeout = setTimeout(() => {
      proc.kill()
      resolve('')
    }, 5000)

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.on('close', () => {
      clearTimeout(timeout)
      resolve(stdout.trim())
    })
    proc.on('error', () => {
      clearTimeout(timeout)
      resolve('')
    })
  })
}
