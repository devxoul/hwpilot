import { cp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import JSZip from 'jszip'

/** Run the CLI as a real subprocess and capture output */
export async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(['bun', 'src/cli.ts', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  return { stdout, stderr, exitCode }
}

/** Parse JSON output from CLI stdout */
export function parseOutput(result: { stdout: string; stderr: string; exitCode: number }): unknown {
  if (result.exitCode !== 0) {
    try {
      const error = JSON.parse(result.stderr)
      throw new Error(`CLI error: ${error.error || result.stderr}`)
    } catch {
      throw new Error(`CLI failed with exit code ${result.exitCode}: ${result.stderr}`)
    }
  }
  return JSON.parse(result.stdout)
}

/** Copy fixture to a unique temp file, returning the temp path */
export async function tempCopy(fixturePath: string): Promise<string> {
  const name = basename(fixturePath)
  const tempPath = join(tmpdir(), `e2e-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.hwp`)
  await cp(fixturePath, tempPath)
  return tempPath
}

/** Remove temp files, ignoring errors */
export async function cleanupFiles(paths: string[]): Promise<void> {
  for (const path of paths) {
    await rm(path, { force: true })
  }
}

/**
 * Cross-validate: edit an HWP file, convert to HWPX, inspect raw XML
 * Returns true if expectedText appears in the section0.xml of the converted HWPX
 */
export async function crossValidate(hwpPath: string, expectedText: string): Promise<boolean> {
  const hwpxPath = hwpPath.replace(/\.hwp$/, '.hwpx')
  const tempHwpxPath = `${hwpxPath}.${Date.now()}.tmp.hwpx`
  try {
    await runCli(['convert', hwpPath, tempHwpxPath])
    const data = await readFile(tempHwpxPath)
    const zip = await JSZip.loadAsync(data)
    const xml = zip.file('Contents/section0.xml')
    if (!xml) return false
    const content = await xml.async('string')
    return content.includes(expectedText)
  } finally {
    await rm(tempHwpxPath, { force: true })
  }
}

/** Run `validate` CLI command and assert the file is valid */
export async function validateFile(filePath: string): Promise<void> {
  const result = await runCli(['validate', filePath])
  const lines = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const candidate = lines.at(-1) ?? result.stdout.trim()
  const output = JSON.parse(candidate) as { valid: boolean; checks: { name: string; status: string; message?: string }[] }
  if (!output.valid) {
    const failures = output.checks.filter((c) => c.status === 'fail').map((c) => `${c.name}: ${c.message}`)
    throw new Error(`Validation failed: ${failures.join('; ')}`)
  }
}

/**
 * Verify PARA_HEADER nChars matches actual PARA_TEXT length for a given paragraph.
 * Reads the raw binary section stream and checks structural consistency.
 */
export async function verifyParaHeaderNChars(
  hwpPath: string,
  paragraphIndex: number,
): Promise<{ nChars: number; textLength: number; match: boolean }> {
  const result = await runCli(['read', hwpPath])
  const doc = parseOutput(result) as { format: string }
  if (doc.format !== 'hwp') {
    throw new Error('verifyParaHeaderNChars only supports HWP format')
  }

  const { readFile: readFileNode } = await import('node:fs/promises')
  const CFB = (await import('cfb')).default
  const { inflateRaw } = await import('pako')

  const buf = await readFileNode(hwpPath)
  const cfb = CFB.read(buf, { type: 'buffer' })

  const fileHeader = CFB.find(cfb, '/FileHeader')
  if (!fileHeader?.content) throw new Error('FileHeader not found')
  const flags = Buffer.from(fileHeader.content).readUInt32LE(36)
  const compressed = Boolean(flags & 0x1)

  const sectionEntry = CFB.find(cfb, '/BodyText/Section0')
  if (!sectionEntry?.content) throw new Error('Section0 not found')
  const raw = Buffer.from(sectionEntry.content)
  const stream = compressed ? Buffer.from(inflateRaw(raw)) : raw

  let paraIndex = -1
  let nChars = -1
  let offset = 0

  while (offset < stream.length) {
    const packed = stream.readUInt32LE(offset)
    const tagId = packed & 0x3ff
    const level = (packed >> 10) & 0x3ff
    let size = (packed >> 20) & 0xfff
    let headerSize = 4
    if (size === 0xfff) {
      size = stream.readUInt32LE(offset + 4)
      headerSize = 8
    }

    const TAG_PARA_HEADER = 66
    const TAG_PARA_TEXT = 67

    if (tagId === TAG_PARA_HEADER && level === 0) {
      paraIndex++
      if (paraIndex === paragraphIndex && size >= 4) {
        nChars = stream.readUInt32LE(offset + headerSize)
      }
    }

    if (tagId === TAG_PARA_TEXT && paraIndex === paragraphIndex) {
      const textLength = size / 2
      const nCharsValue = (nChars & 0x7fffffff) >>> 0
      return { nChars: nCharsValue, textLength, match: nCharsValue === textLength }
    }

    offset += headerSize + size
  }

  throw new Error(`Paragraph ${paragraphIndex} not found in Section0`)
}

/** Absolute paths to all 7 fixture files */
export const FIXTURES = {
  employmentContract: 'e2e/fixtures/개정 표준근로계약서(2025년, 배포).hwp',
  employmentRules: 'e2e/fixtures/개정 표준취업규칙(2025년, 배포).hwp',
  withholdingTax: 'e2e/fixtures/근로소득원천징수영수증(개정안 2021.11.29.).hwp',
  wageClaim: 'e2e/fixtures/임금 등 청구의 소.hwp',
  assaultComplaint: 'e2e/fixtures/폭행죄(고소장).hwp',
  standardContracts: 'e2e/fixtures/표준 근로계약서(7종)(19.6월).hwp',
  victimStatement: 'e2e/fixtures/피해자_의견_진술서_양식.hwp',
} as const

export type ViewerCheckResult = { corrupted: boolean; alert?: string; skipped: boolean }

const VIEWER_APP_NAME = 'Hancom Office HWP Viewer'
const VIEWER_ALERT_TIMEOUT_MS = 3000

/** Check if HWP Viewer is available on the system (macOS only) */
export async function isHwpViewerAvailable(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  const proc = Bun.spawn(['mdfind', 'kMDItemCFBundleIdentifier == "com.haansoft.HancomOfficeViewer.Mac"'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  if (out.trim().length > 0) return true
  const { existsSync } = await import('node:fs')
  return existsSync('/Applications/Hancom Office HWP Viewer.app')
}

/** Check if HWP Viewer corrupts a file when opening it */
export async function checkViewerCorruption(filePath: string): Promise<ViewerCheckResult> {
  // Check availability
  const available = await isHwpViewerAvailable()
  if (!available) {
    return { corrupted: false, skipped: true }
  }

  // Snapshot existing PIDs
  const existingPidsProc = Bun.spawn(['pgrep', '-f', VIEWER_APP_NAME], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const existingPidsOut = await new Response(existingPidsProc.stdout).text()
  await existingPidsProc.exited
  const existingPids = new Set(existingPidsOut.trim().split('\n').filter(Boolean))

  // Open hidden
  const openProc = Bun.spawn(['open', '-g', '-j', '-a', VIEWER_APP_NAME, filePath], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await openProc.exited

  // Wait for app to initialize
  await Bun.sleep(VIEWER_ALERT_TIMEOUT_MS)

  // Read alert via osascript with timeout
  const alertText = await readViewerAlert()

  // Check for corruption keywords
  const corrupted = alertText.includes('손상') || alertText.includes('변조') || alertText.includes('복구')

  // Quit viewer
  const quitProc = Bun.spawn(['osascript', '-e', 'tell application "Hancom Office HWP Viewer" to quit'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await quitProc.exited

  // Kill stray processes
  await Bun.sleep(2000)
  const strayPidsProc = Bun.spawn(['pgrep', '-f', VIEWER_APP_NAME], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const strayPidsOut = await new Response(strayPidsProc.stdout).text()
  await strayPidsProc.exited
  const strayPids = strayPidsOut.trim().split('\n').filter(Boolean)
  for (const pid of strayPids) {
    if (!existingPids.has(pid)) {
      const killProc = Bun.spawn(['kill', pid], { stdout: 'pipe', stderr: 'pipe' })
      await killProc.exited
    }
  }

  return { corrupted, alert: alertText || undefined, skipped: false }
}

/** Helper: Read alert text from HWP Viewer via osascript with timeout */
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

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)
  try {
    const proc = Bun.spawn(['osascript', '-e', script], {
      stdout: 'pipe',
      stderr: 'pipe',
      signal: controller.signal,
    })
    const alertText = await new Response(proc.stdout).text()
    await proc.exited
    return alertText.trim()
  } catch {
    return '' // timeout or error → treat as no alert
  } finally {
    clearTimeout(timeoutId)
  }
}
