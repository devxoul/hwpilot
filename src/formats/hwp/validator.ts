import { readFile } from 'node:fs/promises'
import CFB from 'cfb'
import { inflateRaw } from 'pako'
import { readControlId } from '@/formats/hwp/control-id'
import { TAG } from '@/formats/hwp/tag-ids'

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip'

export type CheckResult = {
  name: string
  status: CheckStatus
  message?: string
  details?: Record<string, unknown>
}

export type ValidateResult = {
  valid: boolean
  format: 'hwp' | 'hwpx'
  file: string
  checks: CheckResult[]
}

type ParsedRecord = {
  tagId: number
  level: number
  size: number
  headerSize: number
  data: Buffer
  offset: number
}

type StreamRef = {
  name: string
  buffer: Buffer
}

type CfbRoot = {
  FileIndex?: Array<{ name: string; content?: Uint8Array }>
}

export async function validateHwp(filePath: string): Promise<ValidateResult> {
  const fileBuffer = await readFile(filePath)
  const result = await validateHwpBuffer(fileBuffer)
  result.file = filePath
  return result
}

export async function validateHwpBuffer(buffer: Buffer): Promise<ValidateResult> {
  const checks: CheckResult[] = []

  const magic = buffer.subarray(0, 4)
  if (magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04) {
    return {
      valid: true,
      format: 'hwpx',
      file: '<buffer>',
      checks: [],
    }
  }

  let cfb: CFB.CFB$Container
  try {
    cfb = CFB.read(buffer, { type: 'buffer' })
  } catch {
    return {
      valid: false,
      format: 'hwp',
      file: '<buffer>',
      checks: [{ name: 'file_format', status: 'fail', message: 'Not a valid HWP or HWPX file' }],
    }
  }

  const cfbLayer = validateCfbStructure(cfb)
  checks.push(cfbLayer.check)
  if (cfbLayer.check.status === 'fail') {
    return {
      valid: false,
      format: 'hwp',
      file: '<buffer>',
      checks,
    }
  }

  const docInfoEntry = findEntry(cfb, '/DocInfo', 'DocInfo')
  const docInfoRaw = docInfoEntry?.content ? Buffer.from(docInfoEntry.content) : Buffer.alloc(0)
  const sectionEntries = collectSectionEntries(cfb)

  const streamChecks = validateRecordStreams(docInfoRaw, sectionEntries, cfbLayer.isCompressed)
  checks.push(...streamChecks)

  const docInfoBuffer = getStreamBuffer(docInfoRaw, cfbLayer.isCompressed)
  if (!docInfoBuffer) {
    checks.push({ name: 'docinfo_parse', status: 'fail', message: 'Failed to read DocInfo stream' })
    return {
      valid: checks.every((check) => check.status !== 'fail'),
      format: 'hwp',
      file: '<buffer>',
      checks,
    }
  }

  const sectionStreams = materializeSectionStreams(sectionEntries, cfbLayer.isCompressed)

  checks.push(validateNCharsConsistency(sectionStreams))
  checks.push(validateCrossReferences(docInfoBuffer, sectionStreams))
  checks.push(validateIdMappings(docInfoBuffer))
  checks.push(validateContentCompleteness(docInfoBuffer, sectionStreams))
  checks.push(validateParagraphCompleteness(sectionStreams))
  checks.push(validateTableStructure(sectionStreams))

  return {
    valid: checks.every((check) => check.status !== 'fail'),
    format: 'hwp',
    file: '<buffer>',
    checks,
  }
}

function validateCfbStructure(cfb: CFB.CFB$Container): { check: CheckResult; isCompressed: boolean } {
  const fileHeaderEntry = findEntry(cfb, '/FileHeader', 'FileHeader')
  if (!fileHeaderEntry?.content) {
    return {
      check: { name: 'cfb_structure', status: 'fail', message: 'Missing FileHeader stream' },
      isCompressed: false,
    }
  }

  const headerContent = Buffer.from(fileHeaderEntry.content)
  if (headerContent.length < 40) {
    return {
      check: { name: 'cfb_structure', status: 'fail', message: 'Invalid FileHeader length' },
      isCompressed: false,
    }
  }

  const signature = headerContent.subarray(0, 17).toString('ascii')
  if (!signature.startsWith('HWP Document File')) {
    return {
      check: { name: 'cfb_structure', status: 'fail', message: 'Invalid HWP signature' },
      isCompressed: false,
    }
  }

  const flags = headerContent.readUInt32LE(36)
  if (flags & 0x2) {
    return {
      check: { name: 'cfb_structure', status: 'fail', message: 'Password-protected files are not supported' },
      isCompressed: false,
    }
  }

  const docInfoEntry = findEntry(cfb, '/DocInfo', 'DocInfo')
  if (!docInfoEntry?.content) {
    return {
      check: { name: 'cfb_structure', status: 'fail', message: 'Missing DocInfo stream' },
      isCompressed: false,
    }
  }

  const section0Entry = findEntry(cfb, '/BodyText/Section0', 'BodyText/Section0')
  if (!section0Entry?.content) {
    return {
      check: { name: 'cfb_structure', status: 'fail', message: 'Missing BodyText/Section0 stream' },
      isCompressed: false,
    }
  }

  return {
    check: { name: 'cfb_structure', status: 'pass' },
    isCompressed: Boolean(flags & 0x1),
  }
}

function validateRecordStreams(docInfoRaw: Buffer, sectionEntries: StreamRef[], compressed: boolean): CheckResult[] {
  const streamIssues: CheckResult[] = []
  const streams: StreamRef[] = [{ name: 'DocInfo', buffer: docInfoRaw }, ...sectionEntries]

  for (const stream of streams) {
    const streamBuffer = getStreamBuffer(stream.buffer, compressed)
    if (!streamBuffer) {
      streamIssues.push({
        name: 'decompression',
        status: 'fail',
        message: `Failed to decompress stream: ${stream.name}`,
      })
      continue
    }

    const issue = validateRecordStream(streamBuffer, stream.name)
    if (issue) {
      streamIssues.push(issue)
    }
  }

  if (streamIssues.length === 0) {
    return [{ name: 'record_stream', status: 'pass' }]
  }

  return streamIssues
}

function validateRecordStream(buffer: Buffer, streamName: string): CheckResult | null {
  let offset = 0

  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) {
      return {
        name: 'record_stream',
        status: 'fail',
        message: `Truncated record in ${streamName} at offset ${offset}`,
      }
    }

    const packed = buffer.readUInt32LE(offset)
    const sizeBits = (packed >> 20) & 0xfff
    let size = sizeBits
    let headerSize = 4

    if (sizeBits === 0xfff) {
      if (offset + 8 > buffer.length) {
        return {
          name: 'record_stream',
          status: 'fail',
          message: `Truncated record in ${streamName} at offset ${offset}`,
        }
      }
      size = buffer.readUInt32LE(offset + 4)
      headerSize = 8
    }

    const dataEnd = offset + headerSize + size
    if (dataEnd > buffer.length) {
      return {
        name: 'record_stream',
        status: 'fail',
        message: `Truncated record in ${streamName} at offset ${offset}`,
      }
    }

    offset = dataEnd
  }

  if (offset !== buffer.length) {
    return {
      name: 'record_stream',
      status: 'warn',
      message: `Leftover bytes in ${streamName}: expected end at ${buffer.length}, got ${offset}`,
    }
  }

  return null
}

function validateNCharsConsistency(sectionStreams: StreamRef[]): CheckResult {
  const mismatches: Array<Record<string, unknown>> = []
  const warnings: string[] = []

  for (const stream of sectionStreams) {
    const records = parseRecords(stream.buffer)
    let pendingParagraph: { nChars: number } | null = null
    let paragraphCount = 0
    let lastBitCount = 0

    for (const record of records) {
      if (record.tagId === TAG.PARA_HEADER && record.level === 0) {
        paragraphCount += 1
        pendingParagraph = null

        if (record.size === 0 || record.data.length < 4) {
          continue
        }

        const nCharsRaw = record.data.readUInt32LE(0)
        const nChars = nCharsRaw & 0x7fffffff
        const isLast = Boolean(nCharsRaw & 0x80000000)
        if (isLast) {
          lastBitCount += 1
        }

        pendingParagraph = { nChars }
        continue
      }

      if (record.tagId === TAG.PARA_TEXT && pendingParagraph) {
        const textLength = record.data.length / 2
        if (pendingParagraph.nChars !== textLength) {
          mismatches.push({
            stream: stream.name,
            offset: record.offset,
            expectedNChars: pendingParagraph.nChars,
            actualTextChars: textLength,
          })
        }
        pendingParagraph = null
      }
    }

    if (lastBitCount > 1) {
      warnings.push(`Multiple last-paragraph bits set in ${stream.name}`)
    } else if (lastBitCount === 0 && paragraphCount > 0) {
      warnings.push(`No last-paragraph bit set in ${stream.name}`)
    }
  }

  if (mismatches.length > 0) {
    return {
      name: 'nchars_consistency',
      status: 'fail',
      message: `Found ${mismatches.length} nChars mismatch(es)`,
      details: {
        mismatchCount: mismatches.length,
        examples: mismatches.slice(0, 10),
        warnings,
      },
    }
  }

  if (warnings.length > 0) {
    return {
      name: 'nchars_consistency',
      status: 'warn',
      message: warnings.join('; '),
      details: { warningCount: warnings.length },
    }
  }

  return { name: 'nchars_consistency', status: 'pass' }
}

function validateCrossReferences(docInfoBuffer: Buffer, sectionStreams: StreamRef[]): CheckResult {
  const docInfoRecords = parseRecords(docInfoBuffer)
  const fontCount = docInfoRecords.filter((record) => record.tagId === TAG.FACE_NAME).length
  const charShapeRecords = docInfoRecords.filter((record) => record.tagId === TAG.CHAR_SHAPE)
  const charShapeCount = charShapeRecords.filter((record) => record.data.length >= 56).length
  const paraShapeCount = docInfoRecords.filter((record) => record.tagId === TAG.PARA_SHAPE).length
  const styleCount = docInfoRecords.filter((record) => record.tagId === TAG.STYLE).length

  const failures: string[] = []

  for (const record of charShapeRecords) {
    if (record.data.length < 2) {
      continue
    }
    const fontRef = record.data.readUInt16LE(0)
    if (fontRef >= fontCount) {
      failures.push(`DocInfo CHAR_SHAPE fontRef out of bounds: ${fontRef} >= ${fontCount}`)
      if (failures.length >= 10) {
        break
      }
    }
  }

  if (failures.length < 10) {
    for (const stream of sectionStreams) {
      const records = parseRecords(stream.buffer)
      for (const record of records) {
        if (record.tagId === TAG.PARA_HEADER && record.level === 0 && record.data.length >= 10) {
          const paraShapeRef = record.data.readUInt16LE(8)
          if (paraShapeRef >= paraShapeCount) {
            failures.push(`${stream.name} PARA_HEADER paraShapeRef out of bounds: ${paraShapeRef} >= ${paraShapeCount}`)
            if (failures.length >= 10) {
              break
            }
          }

          if (record.data.length >= 11) {
            const styleRef = record.data.readUInt8(10)
            if (styleRef >= styleCount) {
              failures.push(`${stream.name} PARA_HEADER styleRef out of bounds: ${styleRef} >= ${styleCount}`)
              if (failures.length >= 10) {
                break
              }
            }
          }

          continue
        }

        if (record.tagId !== TAG.PARA_CHAR_SHAPE) {
          continue
        }

        if (record.data.length > 0 && record.data.length % 8 === 0) {
          const entryCount = record.data.length / 8
          for (let i = 0; i < entryCount; i++) {
            const ref = record.data.readUInt32LE(i * 8 + 4)
            if (ref >= charShapeCount) {
              failures.push(`${stream.name} PARA_CHAR_SHAPE ref out of bounds: ${ref} >= ${charShapeCount}`)
              if (failures.length >= 10) {
                break
              }
            }
          }
        } else if (record.data.length >= 6 && record.data.length < 8) {
          const ref = record.data.readUInt16LE(4)
          if (ref >= charShapeCount) {
            failures.push(`${stream.name} PARA_CHAR_SHAPE ref out of bounds: ${ref} >= ${charShapeCount}`)
            if (failures.length >= 10) {
              break
            }
          }
        }

        if (failures.length >= 10) {
          break
        }
      }

      if (failures.length >= 10) {
        break
      }
    }
  }

  if (failures.length === 0) {
    return { name: 'cross_references', status: 'pass' }
  }

  const totalFailureCount = countCrossReferenceFailures(docInfoBuffer, sectionStreams, {
    fontCount,
    charShapeCount,
    paraShapeCount,
    styleCount,
  })

  return {
    name: 'cross_references',
    status: 'fail',
    message: failures.join('; '),
    details: totalFailureCount > failures.length ? { failureCount: totalFailureCount } : undefined,
  }
}

function validateIdMappings(docInfoBuffer: Buffer): CheckResult {
  const records = parseRecords(docInfoBuffer)
  const idMappingsRecord = records.find((record) => record.tagId === TAG.ID_MAPPINGS)
  if (!idMappingsRecord) {
    return {
      name: 'id_mappings',
      status: 'warn',
      message: 'ID_MAPPINGS record not found; cannot verify charShape count',
    }
  }

  const actualCharShapeCount = records.filter((record) => record.tagId === TAG.CHAR_SHAPE).length
  const idMappingsData = idMappingsRecord.data
  const HWP5_CHAR_SHAPE_BYTE_OFFSET = 9 * 4

  if (idMappingsData.length >= HWP5_CHAR_SHAPE_BYTE_OFFSET + 4) {
    const declaredCount = idMappingsData.readUInt32LE(HWP5_CHAR_SHAPE_BYTE_OFFSET)
    if (declaredCount !== actualCharShapeCount) {
      return {
        name: 'id_mappings',
        status: 'fail',
        message: `ID_MAPPINGS charShape mismatch: declared ${declaredCount}, actual ${actualCharShapeCount}`,
      }
    }

    return { name: 'id_mappings', status: 'pass' }
  }

  for (let offset = 0; offset + 4 <= idMappingsData.length; offset += 4) {
    if (idMappingsData.readUInt32LE(offset) === actualCharShapeCount) {
      return { name: 'id_mappings', status: 'pass' }
    }
  }

  return {
    name: 'id_mappings',
    status: 'warn',
    message: 'Unable to verify ID_MAPPINGS charShape count in short record',
  }
}

function validateContentCompleteness(docInfoBuffer: Buffer, sectionStreams: StreamRef[]): CheckResult {
  const declaredCharShapeCount = parseRecords(docInfoBuffer).filter((record) => record.tagId === TAG.CHAR_SHAPE).length
  if (declaredCharShapeCount < 10) {
    return { name: 'content_completeness', status: 'pass' }
  }

  const uniqueRefs = new Set<number>()
  for (const stream of sectionStreams) {
    const records = parseRecords(stream.buffer)
    for (const record of records) {
      if (record.tagId !== TAG.PARA_CHAR_SHAPE) {
        continue
      }

      if (record.data.length > 0 && record.data.length % 8 === 0) {
        const entryCount = record.data.length / 8
        for (let i = 0; i < entryCount; i++) {
          uniqueRefs.add(record.data.readUInt32LE(i * 8 + 4))
        }
      } else if (record.data.length >= 6 && record.data.length < 8) {
        uniqueRefs.add(record.data.readUInt16LE(4))
      }
    }
  }

  const coverageRatio = uniqueRefs.size / declaredCharShapeCount
  if (coverageRatio < 0.5) {
    return {
      name: 'content_completeness',
      status: 'fail',
      message: `Body text references only ${uniqueRefs.size} of ${declaredCharShapeCount} declared charShapes (${(coverageRatio * 100).toFixed(1)}%)`,
      details: {
        declaredCharShapes: declaredCharShapeCount,
        referencedCharShapes: uniqueRefs.size,
        coveragePercent: Math.round(coverageRatio * 100),
      },
    }
  }

  return { name: 'content_completeness', status: 'pass' }
}

function validateParagraphCompleteness(sectionStreams: StreamRef[]): CheckResult {
  const missingCharShape: Array<{ stream: string; level: number }> = []
  const missingLineSeg: Array<{ stream: string; level: number }> = []

  for (const stream of sectionStreams) {
    const records = parseRecords(stream.buffer)

    // Track pending paragraph scopes by level.
    // When a PARA_HEADER at level L is encountered, it starts a scope.
    // Sub-records at level L+1 belong to it.
    // The scope ends when the next PARA_HEADER at level <= L appears.
    const pendingByLevel = new Map<number, { hasText: boolean; hasCharShape: boolean; hasLineSeg: boolean }>()

    for (const record of records) {
      if (record.tagId === TAG.PARA_HEADER) {
        // Flush any existing paragraph at this level (and deeper — they're implicitly closed)
        for (const [level, pending] of pendingByLevel) {
          if (level >= record.level) {
            if (pending.hasText && !pending.hasCharShape) {
              missingCharShape.push({ stream: stream.name, level })
            }
            if (pending.hasText && !pending.hasLineSeg) {
              missingLineSeg.push({ stream: stream.name, level })
            }
            pendingByLevel.delete(level)
          }
        }

        pendingByLevel.set(record.level, { hasText: false, hasCharShape: false, hasLineSeg: false })
        continue
      }

      // Assign sub-records to their parent paragraph.
      // Normally sub-records are at level+1, but some producers (including
      // corrupted files) emit them at the same level as PARA_HEADER.
      for (const [level, pending] of pendingByLevel) {
        if (record.level === level + 1 || record.level === level) {
          if (record.tagId === TAG.PARA_TEXT) pending.hasText = true
          if (record.tagId === TAG.PARA_CHAR_SHAPE) pending.hasCharShape = true
          if (record.tagId === TAG.PARA_LINE_SEG) pending.hasLineSeg = true
        }
      }
    }

    // Flush remaining paragraphs
    for (const [level, pending] of pendingByLevel) {
      if (pending.hasText && !pending.hasCharShape) {
        missingCharShape.push({ stream: stream.name, level })
      }
      if (pending.hasText && !pending.hasLineSeg) {
        missingLineSeg.push({ stream: stream.name, level })
      }
    }
  }

  if (missingCharShape.length > 0) {
    return {
      name: 'paragraph_completeness',
      status: 'fail',
      message: `${missingCharShape.length} paragraph(s) with text missing PARA_CHAR_SHAPE`,
      details: {
        missingCharShapeCount: missingCharShape.length,
        missingLineSegCount: missingLineSeg.length,
        examples: missingCharShape.slice(0, 5),
      },
    }
  }

  if (missingLineSeg.length > 0) {
    return {
      name: 'paragraph_completeness',
      status: 'fail',
      message: `${missingLineSeg.length} paragraph(s) with text missing PARA_LINE_SEG`,
      details: {
        missingLineSegCount: missingLineSeg.length,
        examples: missingLineSeg.slice(0, 5),
      },
    }
  }

  return { name: 'paragraph_completeness', status: 'pass' }
}

// Minimum sizes observed in well-formed Hancom-created HWP files.
// Our broken table add produces truncated records that the Hancom Viewer rejects.
const TABLE_CTRL_HEADER_MIN_SIZE = 44
const TABLE_RECORD_MIN_SIZE = 34
const TABLE_CELL_LIST_HEADER_MIN_SIZE = 46

function validateTableStructure(sectionStreams: StreamRef[]): CheckResult {
  const issues: string[] = []

  for (const stream of sectionStreams) {
    const records = parseRecords(stream.buffer)
    let tableCtrlLevel: number | null = null
    let expectedCellCount = 0
    let gridCoverage = 0
    let tableStartIndex = -1

    for (let i = 0; i < records.length; i++) {
      const record = records[i]

      // Detect table CTRL_HEADER or end table context on sibling controls
      if (record.tagId === TAG.CTRL_HEADER && record.data.length >= 4) {
        const controlType = readControlId(record.data)
        if (controlType === 'tbl ') {
          // Flush previous table context if any
          if (tableCtrlLevel !== null && expectedCellCount > 0 && gridCoverage !== expectedCellCount) {
            issues.push(
              `${stream.name} table at record ${tableStartIndex}: expected grid coverage ${expectedCellCount}, got ${gridCoverage}`,
            )
          }

          tableCtrlLevel = record.level
          expectedCellCount = 0
          gridCoverage = 0
          tableStartIndex = i

          if (record.data.length < TABLE_CTRL_HEADER_MIN_SIZE) {
            issues.push(
              `${stream.name} table CTRL_HEADER at record ${i}: size ${record.data.length} < minimum ${TABLE_CTRL_HEADER_MIN_SIZE}`,
            )
          }
          continue
        }

        // Non-table CTRL_HEADER at same level ends the table context
        if (tableCtrlLevel !== null && record.level <= tableCtrlLevel) {
          if (expectedCellCount > 0 && gridCoverage !== expectedCellCount) {
            issues.push(
              `${stream.name} table at record ${tableStartIndex}: expected grid coverage ${expectedCellCount}, got ${gridCoverage}`,
            )
          }
          tableCtrlLevel = null
          expectedCellCount = 0
          gridCoverage = 0
        }
      }

      // End table context when we leave the table subtree
      if (tableCtrlLevel !== null && record.tagId === TAG.PARA_HEADER && record.level === 0) {
        if (expectedCellCount > 0 && gridCoverage !== expectedCellCount) {
          issues.push(
            `${stream.name} table at record ${tableStartIndex}: expected grid coverage ${expectedCellCount}, got ${gridCoverage}`,
          )
        }
        tableCtrlLevel = null
        expectedCellCount = 0
        gridCoverage = 0
      }

      if (tableCtrlLevel === null) {
        continue
      }

      // Validate TABLE record
      if (record.tagId === TAG.TABLE && record.level === tableCtrlLevel + 1) {
        if (record.data.length < TABLE_RECORD_MIN_SIZE) {
          issues.push(
            `${stream.name} TABLE record at record ${i}: size ${record.data.length} < minimum ${TABLE_RECORD_MIN_SIZE}`,
          )
        }
        if (record.data.length >= 8) {
          const rows = record.data.readUInt16LE(4)
          const cols = record.data.readUInt16LE(6)
          expectedCellCount = rows * cols
        }
        continue
      }

      // Validate cell LIST_HEADER
      if (record.tagId === TAG.LIST_HEADER && record.level === tableCtrlLevel + 1) {
        // Compute grid coverage: use colSpan*rowSpan if available, otherwise 1
        const CELL_SPAN_OFFSET = 12 // colSpan at offset 12, rowSpan at offset 14 in LIST_HEADER data
        if (record.data.length >= CELL_SPAN_OFFSET + 4) {
          const colSpan = record.data.readUInt16LE(CELL_SPAN_OFFSET)
          const rowSpan = record.data.readUInt16LE(CELL_SPAN_OFFSET + 2)
          gridCoverage += Math.max(1, colSpan) * Math.max(1, rowSpan)
        } else {
          gridCoverage += 1
        }
        if (record.data.length < TABLE_CELL_LIST_HEADER_MIN_SIZE) {
          issues.push(
            `${stream.name} cell LIST_HEADER at record ${i}: size ${record.data.length} < minimum ${TABLE_CELL_LIST_HEADER_MIN_SIZE}`,
          )
        }
      }

      if (issues.length >= 10) {
        break
      }
    }

    // Flush last table context
    if (tableCtrlLevel !== null && expectedCellCount > 0 && gridCoverage !== expectedCellCount) {
      issues.push(
        `${stream.name} table at record ${tableStartIndex}: expected grid coverage ${expectedCellCount}, got ${gridCoverage}`,
      )
    }

    if (issues.length >= 10) {
      break
    }
  }

  if (issues.length === 0) {
    return { name: 'table_structure', status: 'pass' }
  }

  return {
    name: 'table_structure',
    status: 'fail',
    message: issues[0],
    details: {
      issueCount: issues.length,
      examples: issues.slice(0, 10),
    },
  }
}

function collectSectionEntries(cfb: CFB.CFB$Container): StreamRef[] {
  const sectionEntries: StreamRef[] = []
  let sectionIndex = 0

  while (true) {
    const sectionName = `/BodyText/Section${sectionIndex}`
    const sectionEntry = findEntry(cfb, sectionName, `BodyText/Section${sectionIndex}`)
    if (!sectionEntry?.content) {
      break
    }

    sectionEntries.push({
      name: `Section${sectionIndex}`,
      buffer: Buffer.from(sectionEntry.content),
    })
    sectionIndex += 1
  }

  return sectionEntries
}

function materializeSectionStreams(sectionEntries: StreamRef[], compressed: boolean): StreamRef[] {
  const streams: StreamRef[] = []

  for (const entry of sectionEntries) {
    const buffer = getStreamBuffer(entry.buffer, compressed)
    if (buffer) {
      streams.push({ name: entry.name, buffer })
    }
  }

  return streams
}

function getStreamBuffer(raw: Buffer, compressed: boolean): Buffer | null {
  if (!compressed) {
    return raw
  }

  try {
    return Buffer.from(inflateRaw(raw))
  } catch {
    return null
  }
}

function parseRecords(buffer: Buffer): ParsedRecord[] {
  const records: ParsedRecord[] = []
  let offset = 0

  while (offset < buffer.length) {
    if (offset + 4 > buffer.length) {
      break
    }

    const packed = buffer.readUInt32LE(offset)
    const tagId = packed & 0x3ff
    const level = (packed >> 10) & 0x3ff
    let size = (packed >> 20) & 0xfff
    let headerSize = 4

    if (size === 0xfff) {
      if (offset + 8 > buffer.length) {
        break
      }
      size = buffer.readUInt32LE(offset + 4)
      headerSize = 8
    }

    const dataStart = offset + headerSize
    const dataEnd = dataStart + size
    if (dataEnd > buffer.length) {
      break
    }

    records.push({
      tagId,
      level,
      size,
      headerSize,
      data: buffer.subarray(dataStart, dataEnd),
      offset,
    })

    offset = dataEnd
  }

  return records
}

function countCrossReferenceFailures(
  docInfoBuffer: Buffer,
  sectionStreams: StreamRef[],
  bounds: {
    fontCount: number
    charShapeCount: number
    paraShapeCount: number
    styleCount: number
  },
): number {
  let failureCount = 0
  const docInfoRecords = parseRecords(docInfoBuffer)

  for (const record of docInfoRecords) {
    if (record.tagId !== TAG.CHAR_SHAPE || record.data.length < 2) {
      continue
    }
    const fontRef = record.data.readUInt16LE(0)
    if (fontRef >= bounds.fontCount) {
      failureCount += 1
    }
  }

  for (const stream of sectionStreams) {
    const records = parseRecords(stream.buffer)
    for (const record of records) {
      if (record.tagId === TAG.PARA_HEADER && record.level === 0 && record.data.length >= 10) {
        const paraShapeRef = record.data.readUInt16LE(8)
        if (paraShapeRef >= bounds.paraShapeCount) {
          failureCount += 1
        }

        if (record.data.length >= 11) {
          const styleRef = record.data.readUInt8(10)
          if (styleRef >= bounds.styleCount) {
            failureCount += 1
          }
        }

        continue
      }

      if (record.tagId !== TAG.PARA_CHAR_SHAPE) {
        continue
      }

      if (record.data.length > 0 && record.data.length % 8 === 0) {
        const entryCount = record.data.length / 8
        for (let i = 0; i < entryCount; i++) {
          const ref = record.data.readUInt32LE(i * 8 + 4)
          if (ref >= bounds.charShapeCount) {
            failureCount += 1
          }
        }
      } else if (record.data.length >= 6 && record.data.length < 8) {
        const ref = record.data.readUInt16LE(4)
        if (ref >= bounds.charShapeCount) {
          failureCount += 1
        }
      }
    }
  }

  return failureCount
}

function findEntry(cfb: CFB.CFB$Container, ...names: string[]): { content?: Uint8Array } | undefined {
  for (const name of names) {
    const entry = CFB.find(cfb, name) as { content?: Uint8Array } | null
    if (entry) {
      return entry
    }
  }

  const fileIndex = (cfb as CfbRoot).FileIndex ?? []
  const normalizedNames = new Set(names.map((name) => normalizeEntryName(name)))
  for (const entry of fileIndex) {
    if (normalizedNames.has(normalizeEntryName(entry.name))) {
      return entry
    }
  }

  return undefined
}

function normalizeEntryName(name: string): string {
  return name.replace(/^\//, '').replace(/^Root Entry\//, '')
}
