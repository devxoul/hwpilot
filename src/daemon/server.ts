import { realpathSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { createFlushScheduler, type FlushScheduler } from '@/daemon/flush'
import { HwpHolder } from '@/daemon/holder-hwp'
import { HwpxHolder } from '@/daemon/holder-hwpx'
import { createMessageReader, type DaemonResponse, encodeMessage } from '@/daemon/protocol'
import { deleteStateFile, generateToken, getVersion, writeStateFileExclusive } from '@/daemon/state-file'
import {
  extractAllText,
  extractPaginatedText,
  extractRefText,
  findInSections,
  getTableData,
  listImages,
  listTables,
  resolveRef,
} from '@/shared/document-ops'
import type { FormatOptions } from '@/shared/edit-types'
import { detectFormat } from '@/shared/format-detector'
import type { DocumentHeader, Paragraph } from '@/types'

const DEFAULT_IDLE_MS = 15 * 60 * 1000
const DEFAULT_FLUSH_MS = 500

type DaemonHolder = HwpxHolder | HwpHolder

export async function startDaemonServer(filePath: string): Promise<void> {
  const resolvedPath = resolvePath(filePath)
  const format = await detectFormat(resolvedPath)
  const holder: DaemonHolder = format === 'hwp' ? new HwpHolder(resolvedPath) : new HwpxHolder(resolvedPath)
  await holder.load()

  const flushMs = parseEnvMs('HWPILOT_DAEMON_FLUSH_MS', DEFAULT_FLUSH_MS)
  const scheduler = createFlushScheduler(() => holder.flush(), flushMs)

  const token = generateToken()
  const version = getVersion()

  let requestQueue: Promise<void> = Promise.resolve()
  const idleMs = parseEnvMs('HWPILOT_DAEMON_IDLE_MS', DEFAULT_IDLE_MS)
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const server = createServer((socket) => {
    const reader = createMessageReader((msg: unknown) => {
      requestQueue = requestQueue
        .then(async () => {
          const response = await handleRequest(msg, token, holder, scheduler)
          socket.write(encodeMessage(response))
          resetIdleTimer()
        })
        .catch((err: unknown) => {
          const errResponse: DaemonResponse = {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }
          socket.write(encodeMessage(errResponse))
        })
    })

    socket.on('data', (chunk: Buffer) => {
      try {
        reader(chunk)
      } catch (err) {
        const errResponse: DaemonResponse = {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
        socket.write(encodeMessage(errResponse))
      }
    })
    socket.on('error', () => {})
  })

  function resetIdleTimer(): void {
    if (idleTimer) {
      clearTimeout(idleTimer)
    }
    idleTimer = setTimeout(() => {
      void shutdown('idle timeout')
    }, idleMs)
  }

  async function shutdown(reason: string): Promise<void> {
    void reason
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }

    scheduler.cancel()
    try {
      await holder.flush()
    } catch {}

    deleteStateFile(resolvedPath)
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose())
    })
    process.exit(0)
  }

  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', () => resolveListen())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind daemon server')
  }

  try {
    writeStateFileExclusive(resolvedPath, {
      port: address.port,
      token,
      pid: process.pid,
      version,
    })
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
      // Another daemon won the race — exit gracefully
      server.close()
      process.exit(0)
    }
    throw err
  }

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('uncaughtException', (err) => {
    process.stderr.write(`Daemon uncaught exception: ${err.message}\n`)
    void shutdown('uncaughtException')
  })
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`Daemon unhandled rejection: ${reason}\n`)
    void shutdown('unhandledRejection')
  })

  resetIdleTimer()
}

async function handleRequest(
  msg: unknown,
  token: string,
  holder: DaemonHolder,
  scheduler: FlushScheduler,
): Promise<DaemonResponse> {
  if (!isValidRequest(msg)) {
    return { success: false, error: 'Invalid request format' }
  }

  if (msg.token !== token) {
    return { success: false, error: 'Unauthorized: invalid token' }
  }

  const sections = await holder.getSections()

  try {
    switch (msg.command) {
      case 'read': {
        const ref = typeof msg.args.ref === 'string' ? msg.args.ref : undefined
        const header = await holder.getHeader()
        if (ref) {
          const resolved = resolveRef(ref, sections)
          return { success: true, data: enrichReadResult(resolved, header) }
        }

        const offset = numberArg(msg.args.offset, 0)
        const limit = numberArg(msg.args.limit, Number.POSITIVE_INFINITY)
        const hasPagination = msg.args.offset !== undefined || msg.args.limit !== undefined

        return {
          success: true,
          data: {
            format: holder.getFormat(),
            sections: sections.map((section, index) => {
              const paragraphs = hasPagination ? section.paragraphs.slice(offset, offset + limit) : section.paragraphs

              return {
                index,
                ...(hasPagination && {
                  totalParagraphs: section.paragraphs.length,
                  totalTables: section.tables.length,
                  totalImages: section.images.length,
                  totalTextBoxes: section.textBoxes.length,
                }),
                paragraphs: paragraphs.map((paragraph) => enrichParagraph(paragraph, header)),
                tables: section.tables,
                images: section.images,
                textBoxes: section.textBoxes,
              }
            }),
            header,
          },
        }
      }

      case 'text': {
        const ref = typeof msg.args.ref === 'string' ? msg.args.ref : undefined
        if (ref) {
          const text = extractRefText(ref, sections)
          return { success: true, data: { ref, text } }
        }

        const hasPagination = msg.args.offset !== undefined || msg.args.limit !== undefined
        if (hasPagination) {
          const offset = numberArg(msg.args.offset, 0)
          const limit = numberArg(msg.args.limit, Number.POSITIVE_INFINITY)
          const result = extractPaginatedText(sections, offset, limit)
          return { success: true, data: result }
        }

        // HWP full-text must use loadHwpSectionTexts to match direct mode behavior
        if (holder instanceof HwpHolder) {
          const texts = await holder.getSectionTexts()
          return { success: true, data: { text: texts.join('\n') } }
        }

        return { success: true, data: { text: extractAllText(sections) } }
      }

      case 'find': {
        const query = typeof msg.args.query === 'string' ? msg.args.query : ''
        const matches = findInSections(sections, query)
        return { success: true, data: { matches } }
      }

      case 'table-read': {
        const ref = stringArg(msg.args.ref, 'ref')
        return { success: true, data: getTableData(sections, ref) }
      }

      case 'table-list': {
        return { success: true, data: listTables(sections) }
      }

      case 'image-list': {
        return { success: true, data: listImages(sections) }
      }

      case 'edit-text': {
        const ref = stringArg(msg.args.ref, 'ref')
        const text = stringArg(msg.args.text, 'text')
        await holder.applyOperations([{ type: 'setText', ref, text }])
        await scheduler.flushNow()
        return { success: true, data: { ref, text, success: true } }
      }

      case 'edit-format': {
        const ref = stringArg(msg.args.ref, 'ref')
        const format = formatArg(msg.args.format)
        const start = typeof msg.args.start === 'number' ? msg.args.start : undefined
        const end = typeof msg.args.end === 'number' ? msg.args.end : undefined
        await holder.applyOperations([{ type: 'setFormat', ref, format, start, end }])
        await scheduler.flushNow()
        return { success: true, data: { ref, format, success: true } }
      }

      case 'table-edit': {
        const ref = stringArg(msg.args.ref, 'ref')
        const text = stringArg(msg.args.text, 'text')
        await holder.applyOperations([{ type: 'setTableCell', ref, text }])
        await scheduler.flushNow()
        return { success: true, data: { ref, text, success: true } }
      }

      case 'table-add': {
        const rows = numberArg(msg.args.rows, 0)
        const cols = numberArg(msg.args.cols, 0)
        const data = Array.isArray(msg.args.data) ? (msg.args.data as string[][]) : undefined
        const tableCount = sections[0]?.tables.length ?? 0
        await holder.applyOperations([{ type: 'addTable', ref: 's0', rows, cols, data }])
        await scheduler.flushNow()
        const newRef = `s0.t${tableCount}`
        return { success: true, data: { ref: newRef, rows, cols, success: true } }
      }

      case 'paragraph-add': {
        const ref = stringArg(msg.args.ref, 'ref')
        const text = stringArg(msg.args.text, 'text')
        const position = stringArg(msg.args.position, 'position')
        const format = msg.args.format as FormatOptions | undefined
        const heading = msg.args.heading as number | undefined
        const style = msg.args.style as string | number | undefined
        await holder.applyOperations([
          { type: 'addParagraph', ref, text, position: position as 'before' | 'after' | 'end', format, heading, style },
        ])
        await scheduler.flushNow()
        return { success: true, data: { ref, text, position, success: true } }
      }

      default:
        return { success: false, error: `Unknown command: ${msg.command}` }
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function resolvePath(filePath: string): string {
  const absolutePath = resolve(filePath)
  try {
    return realpathSync(absolutePath)
  } catch {
    return absolutePath
  }
}

function parseEnvMs(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }

  return parsed
}

function numberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${name}`)
  }
  return value
}

function formatArg(value: unknown): FormatOptions {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid format')
  }

  const format = value as Record<string, unknown>
  const output: FormatOptions = {}

  if (typeof format.bold === 'boolean') output.bold = format.bold
  if (typeof format.italic === 'boolean') output.italic = format.italic
  if (typeof format.underline === 'boolean') output.underline = format.underline
  if (typeof format.fontName === 'string') output.fontName = format.fontName
  if (typeof format.fontSize === 'number') output.fontSize = format.fontSize
  if (typeof format.color === 'string') output.color = format.color

  return output
}

function isValidRequest(msg: unknown): msg is { token: string; command: string; args: Record<string, unknown> } {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'token' in msg &&
    'command' in msg &&
    'args' in msg &&
    typeof (msg as { token: unknown }).token === 'string' &&
    typeof (msg as { command: unknown }).command === 'string' &&
    typeof (msg as { args: unknown }).args === 'object' &&
    (msg as { args: unknown }).args !== null
  )
}

function enrichReadResult(resolved: unknown, header: DocumentHeader): unknown {
  if (!resolved || typeof resolved !== 'object') {
    return resolved
  }

  if ('ref' in resolved && 'runs' in resolved) {
    return enrichParagraph(resolved as Paragraph, header)
  }

  return resolved
}

function enrichParagraph(
  para: Paragraph,
  header: DocumentHeader,
): Paragraph & { headingLevel?: number; styleName?: string } {
  const enriched: Paragraph & { headingLevel?: number; styleName?: string } = { ...para }

  const paraShape = header.paraShapes.find((shape) => shape.id === para.paraShapeRef)
  if (paraShape?.headingLevel && paraShape.headingLevel > 0) {
    enriched.headingLevel = paraShape.headingLevel
  }

  const style = header.styles.find((item) => item.id === para.styleRef)
  if (style) {
    enriched.styleName = style.name
  }

  return enriched
}
