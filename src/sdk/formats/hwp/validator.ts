import CFB from 'cfb'
import { inflateRaw } from 'pako'

import { readControlId } from '@/sdk/formats/hwp/control-id'
import { parseStyleRefs } from '@/sdk/formats/hwp/docinfo-parser'
import { KNOWN_TAG_IDS, TAG } from '@/sdk/formats/hwp/tag-ids'

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

export const HWP_PROP_COMPRESSED = 0x00000001
export const HWP_PROP_ENCRYPTED = 0x00000002
export const HWP_PROP_DISTRIBUTION = 0x00000004
export const HWP_PROP_HAS_SCRIPTS = 0x00000008
export const HWP_PROP_DRM = 0x00000010
export const HWP_PROP_HAS_XMLTEMPLATE = 0x00000020
export const HWP_PROP_HAS_DOCHISTORY = 0x00000040
export const HWP_PROP_HAS_SIGNATURE = 0x00000080
export const HWP_PROP_CERT_ENCRYPTED = 0x00000100
export const HWP_PROP_SIGN_PREVIEW = 0x00000200
export const HWP_PROP_CERT_DRM = 0x00000400
export const HWP_PROP_CCL = 0x00000800
export const HWP_PROP_MOBILE = 0x00001000
export const HWP_PROP_PRIVACY = 0x00002000
export const HWP_PROP_TRACK_CHANGES = 0x00004000
export const HWP_PROP_KOGL = 0x00008000
export const HWP_PROP_HAS_VIDEO = 0x00010000
export const HWP_PROP_HAS_TOC_FIELD = 0x00020000

type IdMappingMismatch = {
  field: string
  declared: number
  actual: number
}

type HierarchyViolation = {
  stream: string
  offset: number
  tagId: number
  level: number
  reason: string
}

type ControlCharViolation = {
  stream: string
  offset: number
  position: number
  code?: number
  reason: string
}

const ID_MAPPING_FIELDS = [
  { field: 'binary_data_count', offset: 0, tagId: TAG.BIN_DATA },
  { field: 'korean_font_count', offset: 4, tagId: TAG.FACE_NAME },
  { field: 'english_font_count', offset: 8, tagId: TAG.FACE_NAME },
  { field: 'chinese_font_count', offset: 12, tagId: TAG.FACE_NAME },
  { field: 'japanese_font_count', offset: 16, tagId: TAG.FACE_NAME },
  { field: 'other_font_count', offset: 20, tagId: TAG.FACE_NAME },
  { field: 'symbol_font_count', offset: 24, tagId: TAG.FACE_NAME },
  { field: 'user_font_count', offset: 28, tagId: TAG.FACE_NAME },
  { field: 'border_fill_count', offset: 32, tagId: TAG.BORDER_FILL },
  { field: 'char_shape_count', offset: 36, tagId: TAG.CHAR_SHAPE },
  { field: 'tab_def_count', offset: 40, tagId: TAG.TAB_DEF },
  { field: 'numbering_count', offset: 44, tagId: TAG.NUMBERING },
  { field: 'bullet_count', offset: 48, tagId: TAG.BULLET },
  { field: 'para_shape_count', offset: 52, tagId: TAG.PARA_SHAPE },
  { field: 'style_count', offset: 56, tagId: TAG.STYLE },
] as const

const MULTI_WCHAR_CONTROL_CODES = new Set<number>([
  0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0b, 0x0c, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
  0x16, 0x17,
])

export async function validateHwp(fileBuffer: Uint8Array): Promise<ValidateResult> {
  const result = await validateHwpBuffer(Buffer.from(fileBuffer))
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
      checks: [
        { name: 'format_type', status: 'skip', message: 'HWPX (ZIP) format detected; HWP-specific validation skipped' },
      ],
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
  checks.push(...cfbLayer.checks)
  if (cfbLayer.checks.some((check) => check.status === 'fail')) {
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
  checks.push(validateUnknownTags(docInfoBuffer, sectionStreams))
  checks.push(validateRecordHierarchy(sectionStreams))
  checks.push(validateControlCharIntegrity(sectionStreams))
  checks.push(validateContentCompleteness(docInfoBuffer, sectionStreams))
  checks.push(validateParagraphCompleteness(sectionStreams))
  checks.push(validateTableStructure(sectionStreams))
  checks.push(validateEmptyParagraphText(sectionStreams))

  return {
    valid: checks.every((check) => check.status !== 'fail'),
    format: 'hwp',
    file: '<buffer>',
    checks,
  }
}

function validateCfbStructure(cfb: CFB.CFB$Container): { checks: CheckResult[]; isCompressed: boolean } {
  const fileHeaderEntry = findEntry(cfb, '/FileHeader', 'FileHeader')
  if (!fileHeaderEntry?.content) {
    return {
      checks: [{ name: 'cfb_structure', status: 'fail', message: 'Missing FileHeader stream' }],
      isCompressed: false,
    }
  }

  const headerContent = Buffer.from(fileHeaderEntry.content)
  if (headerContent.length < 44) {
    return {
      checks: [{ name: 'cfb_structure', status: 'fail', message: 'Invalid FileHeader length' }],
      isCompressed: false,
    }
  }

  const signature = headerContent.subarray(0, 17).toString('ascii')
  if (!signature.startsWith('HWP Document File')) {
    return {
      checks: [{ name: 'cfb_structure', status: 'fail', message: 'Invalid HWP signature' }],
      isCompressed: false,
    }
  }

  const versionRaw = headerContent.readUInt32LE(32)
  const version = {
    major: (versionRaw >>> 24) & 0xff,
    minor: (versionRaw >>> 16) & 0xff,
    micro: (versionRaw >>> 8) & 0xff,
    build: versionRaw & 0xff,
    raw: versionRaw,
  }
  const flags1 = headerContent.readUInt32LE(36)
  const flags2 = headerContent.readUInt32LE(40)
  const propertyDetails = {
    properties1: flags1,
    properties2: flags2,
    compressed: Boolean(flags1 & HWP_PROP_COMPRESSED),
    hasScripts: Boolean(flags1 & HWP_PROP_HAS_SCRIPTS),
    hasDocHistory: Boolean(flags1 & HWP_PROP_HAS_DOCHISTORY),
    hasSignature: Boolean(flags1 & HWP_PROP_HAS_SIGNATURE),
    ccl: Boolean(flags1 & HWP_PROP_CCL),
    kogl: Boolean(flags1 & HWP_PROP_KOGL),
    mobileOptimized: Boolean(flags1 & HWP_PROP_MOBILE),
    privacySecured: Boolean(flags1 & HWP_PROP_PRIVACY),
    trackChanges: Boolean(flags1 & HWP_PROP_TRACK_CHANGES),
    hasVideo: Boolean(flags1 & HWP_PROP_HAS_VIDEO),
    hasTocField: Boolean(flags1 & HWP_PROP_HAS_TOC_FIELD),
  }
  const cfbStructureCheck: CheckResult = {
    name: 'cfb_structure',
    status: 'pass',
    details: {
      ...propertyDetails,
      version,
    },
  }

  if (flags1 & HWP_PROP_ENCRYPTED) {
    return {
      checks: [{ ...cfbStructureCheck, status: 'fail', message: 'Password-protected files are not supported' }],
      isCompressed: false,
    }
  }

  if (flags1 & HWP_PROP_DISTRIBUTION) {
    return {
      checks: [
        {
          ...cfbStructureCheck,
          status: 'fail',
          message: 'Distribution documents are not supported (BodyText is stored in ViewText)',
        },
      ],
      isCompressed: false,
    }
  }

  if (flags1 & (HWP_PROP_DRM | HWP_PROP_CERT_DRM | HWP_PROP_CERT_ENCRYPTED)) {
    return {
      checks: [{ ...cfbStructureCheck, status: 'fail', message: 'DRM-protected files are not supported' }],
      isCompressed: false,
    }
  }

  const checks: CheckResult[] = [cfbStructureCheck]
  if (version.raw === 0) {
    checks.push({
      name: 'schema_version',
      status: 'warn',
      message: 'FileHeader FILEVERSION is zero; cannot determine HWP schema version',
      details: { version },
    })
  } else if (version.major !== 5) {
    checks.push({
      name: 'schema_version',
      status: 'fail',
      message: `Unsupported HWP schema version ${version.major}.${version.minor}.${version.micro}.${version.build}`,
      details: { version },
    })
  } else {
    checks.push({ name: 'schema_version', status: 'pass', details: { version } })
  }

  if (propertyDetails.trackChanges) {
    checks.push({
      name: 'document_properties',
      status: 'warn',
      message: 'Document has track changes enabled; editing may lose revision history',
      details: propertyDetails,
    })
  }

  const docInfoEntry = findEntry(cfb, '/DocInfo', 'DocInfo')
  if (!docInfoEntry?.content) {
    return {
      checks: [{ ...cfbStructureCheck, status: 'fail', message: 'Missing DocInfo stream' }, ...checks.slice(1)],
      isCompressed: false,
    }
  }

  const section0Entry = findEntry(cfb, '/BodyText/Section0', 'BodyText/Section0')
  if (!section0Entry?.content) {
    return {
      checks: [{ ...cfbStructureCheck, status: 'fail', message: 'Missing BodyText/Section0 stream' }, ...checks.slice(1)],
      isCompressed: false,
    }
  }

  return {
    checks,
    isCompressed: propertyDetails.compressed,
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
  const charShapeCount = charShapeRecords.length
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

  const idMappingsData = idMappingsRecord.data
  const HWP5_CHAR_SHAPE_BYTE_OFFSET = 9 * 4
  const actualCounts = new Map<number, number>()

  for (const record of records) {
    actualCounts.set(record.tagId, (actualCounts.get(record.tagId) ?? 0) + 1)
  }

  if (idMappingsData.length >= HWP5_CHAR_SHAPE_BYTE_OFFSET + 4) {
    const mismatches: IdMappingMismatch[] = []
    const checkedFields: string[] = []
    const declaredFontCount = collectDeclaredFontCount(idMappingsData)
    const actualFontCount = actualCounts.get(TAG.FACE_NAME) ?? 0

    for (const { field, offset, tagId } of ID_MAPPING_FIELDS) {
      if (offset + 4 > idMappingsData.length) {
        continue
      }

      checkedFields.push(field)
      if (field.endsWith('_font_count')) {
        continue
      }

      const declared = idMappingsData.readUInt32LE(offset)
      const actual = actualCounts.get(tagId) ?? 0
      if (declared !== actual) {
        mismatches.push({ field, declared, actual })
      }
    }

    if (declaredFontCount !== null && declaredFontCount !== actualFontCount) {
      mismatches.push({
        field: 'font_bucket_total',
        declared: declaredFontCount,
        actual: actualFontCount,
      })
    }

    if (mismatches.length > 0) {
      return {
        name: 'id_mappings',
        status: 'fail',
        message: mismatches
          .map((mismatch) => `${mismatch.field}: declared ${mismatch.declared}, actual ${mismatch.actual}`)
          .join('; '),
        details: {
          mismatchCount: mismatches.length,
          mismatches,
          checkedFields,
        },
      }
    }

    return { name: 'id_mappings', status: 'pass' }
  }

  const actualCharShapeCount = actualCounts.get(TAG.CHAR_SHAPE) ?? 0
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

function validateUnknownTags(docInfoBuffer: Buffer, sectionStreams: StreamRef[]): CheckResult {
  const unknownTagMap = new Map<number, { count: number; streams: Set<string> }>()
  const streams: Array<{ name: string; buffer: Buffer }> = [
    { name: 'DocInfo', buffer: docInfoBuffer },
    ...sectionStreams,
  ]

  for (const stream of streams) {
    for (const record of parseRecords(stream.buffer)) {
      if (KNOWN_TAG_IDS.has(record.tagId)) {
        continue
      }

      const entry = unknownTagMap.get(record.tagId) ?? { count: 0, streams: new Set<string>() }
      entry.count += 1
      entry.streams.add(stream.name)
      unknownTagMap.set(record.tagId, entry)
    }
  }

  if (unknownTagMap.size === 0) {
    return { name: 'unknown_tags', status: 'pass' }
  }

  const entries = [...unknownTagMap.entries()]
    .map(([tagId, info]) => ({
      tagId,
      count: info.count,
      streams: [...info.streams].sort(),
    }))
    .sort((left, right) => right.count - left.count || left.tagId - right.tagId)

  return {
    name: 'unknown_tags',
    status: 'warn',
    message: `Found ${entries.length} unknown tag ID(s): ${entries
      .map((entry) => `${formatTagId(entry.tagId)} (×${entry.count})`)
      .join(', ')}`,
    details: {
      unknownTagCount: entries.length,
      unknownTags: entries.slice(0, 20),
    },
  }
}

function validateRecordHierarchy(sectionStreams: StreamRef[]): CheckResult {
  const violations: HierarchyViolation[] = []

  for (const stream of sectionStreams) {
    const records = parseRecords(stream.buffer)
    const paraLevels: number[] = []
    const ctrlHeaders: Array<{ level: number; controlType: string | null }> = []

    for (const record of records) {
      if (record.tagId === TAG.PARA_HEADER) {
        while (paraLevels.length > 0 && paraLevels.at(-1)! >= record.level) {
          paraLevels.pop()
        }
        while (ctrlHeaders.length > 0 && ctrlHeaders.at(-1)!.level >= record.level) {
          ctrlHeaders.pop()
        }
        paraLevels.push(record.level)
        continue
      }

      if (record.tagId === TAG.CTRL_HEADER) {
        const parentParaLevel = findNearestLowerLevel(paraLevels, record.level)
        if (parentParaLevel === null) {
          if (paraLevels.length === 0) {
            violations.push({
              stream: stream.name,
              offset: record.offset,
              tagId: record.tagId,
              level: record.level,
              reason: 'CTRL_HEADER appears without a preceding PARA_HEADER',
            })
          }
        } else if (record.level !== parentParaLevel + 1) {
          violations.push({
            stream: stream.name,
            offset: record.offset,
            tagId: record.tagId,
            level: record.level,
            reason: `CTRL_HEADER level ${record.level} does not match parent PARA_HEADER level ${parentParaLevel} + 1`,
          })
        }

        while (ctrlHeaders.length > 0 && ctrlHeaders.at(-1)!.level >= record.level) {
          ctrlHeaders.pop()
        }
        ctrlHeaders.push({
          level: record.level,
          controlType: record.data.length >= 4 ? readControlId(record.data) : null,
        })
      } else if (record.tagId === TAG.TABLE) {
        const parentCtrlHeader = findNearestCtrlHeader(ctrlHeaders, record.level)
        if (
          !parentCtrlHeader ||
          parentCtrlHeader.controlType !== 'tbl ' ||
          record.level !== parentCtrlHeader.level + 1
        ) {
          violations.push({
            stream: stream.name,
            offset: record.offset,
            tagId: record.tagId,
            level: record.level,
            reason: parentCtrlHeader
              ? `TABLE level ${record.level} does not match parent CTRL_HEADER level ${parentCtrlHeader.level} + 1`
              : 'TABLE appears without a preceding table CTRL_HEADER',
          })
        }
      } else if (record.tagId === TAG.SHAPE_COMPONENT || record.tagId === TAG.LIST_HEADER) {
        const parentCtrlHeader = findNearestCtrlHeader(ctrlHeaders, record.level)
        if (!parentCtrlHeader || record.level < parentCtrlHeader.level + 1) {
          violations.push({
            stream: stream.name,
            offset: record.offset,
            tagId: record.tagId,
            level: record.level,
            reason: parentCtrlHeader
              ? `${getTagName(record.tagId)} level ${record.level} is below parent CTRL_HEADER level ${parentCtrlHeader.level} + 1`
              : `${getTagName(record.tagId)} appears without a preceding CTRL_HEADER`,
          })
        }
      } else if (
        record.tagId === TAG.PARA_CHAR_SHAPE ||
        record.tagId === TAG.PARA_TEXT ||
        record.tagId === TAG.PARA_LINE_SEG ||
        record.tagId === TAG.PARA_RANGE_TAG
      ) {
        const parentParaLevel = findNearestParagraphLevel(paraLevels, record.level)
        if (parentParaLevel === null) {
          if (record.level === 0) {
            violations.push({
              stream: stream.name,
              offset: record.offset,
              tagId: record.tagId,
              level: record.level,
              reason: `${getTagName(record.tagId)} appears without a preceding PARA_HEADER`,
            })
          }
        }
      }

      if (violations.length >= 10) {
        break
      }
    }

    if (violations.length >= 10) {
      break
    }
  }

  if (violations.length === 0) {
    return { name: 'record_hierarchy', status: 'pass' }
  }

  return {
    name: 'record_hierarchy',
    status: 'warn',
    message: `Found ${violations.length} record hierarchy violation(s)`,
    details: {
      violationCount: violations.length,
      examples: violations.slice(0, 10),
    },
  }
}

function validateControlCharIntegrity(sectionStreams: StreamRef[]): CheckResult {
  const violations: ControlCharViolation[] = []

  for (const stream of sectionStreams) {
    const records = parseRecords(stream.buffer)
    for (let recordIndex = 0; recordIndex < records.length; recordIndex++) {
      const record = records[recordIndex]
      if (record.tagId !== TAG.PARA_TEXT) {
        continue
      }

      if (record.data.length % 2 !== 0) {
        violations.push({
          stream: stream.name,
          offset: record.offset,
          position: Math.floor(record.data.length / 2),
          reason: `PARA_TEXT has odd byte count (${record.data.length})`,
        })
        continue
      }

      const wcharCount = record.data.length / 2
      let position = 0
      while (position < wcharCount) {
        const code = record.data.readUInt16LE(position * 2)
        if (code < 0x20 && MULTI_WCHAR_CONTROL_CODES.has(code)) {
          if (position + 8 > wcharCount) {
            // Some real-world files and existing project fixtures encode the table placeholder
            // as a lone 0x0B in PARA_TEXT and carry the actual control metadata in a following
            // CTRL_HEADER record. Treat that legacy shorthand as acceptable to avoid noisy
            // false positives; for everything else, keep the spec-grounded truncation check.
            if (isCompatTrailingControl(records, recordIndex, position, code)) {
              break
            }

            violations.push({
              stream: stream.name,
              offset: record.offset,
              position,
              code,
              reason: `Truncated control ${formatControlCode(code)} at WCHAR ${position}, needed 8 WCHARs`,
            })
            break
          }
          position += 8
          continue
        }

        position += 1
      }

      if (violations.length >= 10) {
        break
      }
    }

    if (violations.length >= 10) {
      break
    }
  }

  if (violations.length === 0) {
    return { name: 'control_char_integrity', status: 'pass' }
  }

  return {
    name: 'control_char_integrity',
    status: 'fail',
    message: violations[0].reason,
    details: {
      violationCount: violations.length,
      examples: violations.slice(0, 10),
    },
  }
}

function validateContentCompleteness(docInfoBuffer: Buffer, sectionStreams: StreamRef[]): CheckResult {
  const docInfoRecords = parseRecords(docInfoBuffer)
  const declaredCharShapeCount = docInfoRecords.filter((record) => record.tagId === TAG.CHAR_SHAPE).length
  if (declaredCharShapeCount < 10) {
    return { name: 'content_completeness', status: 'pass' }
  }

  const uniqueRefs = new Set<number>()

  for (const record of docInfoRecords) {
    if (record.tagId !== TAG.STYLE) continue
    const refs = parseStyleRefs(record.data)
    const ref = refs?.charShapeRef ?? -1
    if (ref >= 0 && ref < declaredCharShapeCount) {
      uniqueRefs.add(ref)
    }
  }

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

    const pendingByLevel = new Map<
      number,
      { hasText: boolean; hasCharShape: boolean; hasLineSeg: boolean; hasCtrl: boolean }
    >()

    for (const record of records) {
      if (record.tagId === TAG.PARA_HEADER) {
        for (const [level, pending] of pendingByLevel) {
          if (level >= record.level) {
            if (pending.hasText && !pending.hasCharShape) {
              missingCharShape.push({ stream: stream.name, level })
            }
            if (pending.hasText && !pending.hasLineSeg && !pending.hasCtrl) {
              missingLineSeg.push({ stream: stream.name, level })
            }
            pendingByLevel.delete(level)
          }
        }

        pendingByLevel.set(record.level, {
          hasText: false,
          hasCharShape: false,
          hasLineSeg: false,
          hasCtrl: false,
        })
        continue
      }

      for (const [level, pending] of pendingByLevel) {
        if (record.level === level + 1 || record.level === level) {
          if (record.tagId === TAG.PARA_TEXT) {
            pending.hasText = true
          }
          if (record.tagId === TAG.PARA_CHAR_SHAPE) pending.hasCharShape = true
          if (record.tagId === TAG.PARA_LINE_SEG) pending.hasLineSeg = true
          if (record.tagId === TAG.CTRL_HEADER) pending.hasCtrl = true
        }
      }
    }

    for (const [level, pending] of pendingByLevel) {
      if (pending.hasText && !pending.hasCharShape) {
        missingCharShape.push({ stream: stream.name, level })
      }
      if (pending.hasText && !pending.hasLineSeg && !pending.hasCtrl) {
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

function validateEmptyParagraphText(sectionStreams: StreamRef[]): CheckResult {
  const issues: Array<{ stream: string; offset: number }> = []

  for (const stream of sectionStreams) {
    const records = parseRecords(stream.buffer)
    let pendingEmpty: { offset: number } | null = null

    for (const record of records) {
      if (record.tagId === TAG.PARA_HEADER && record.level === 0) {
        pendingEmpty = null
        if (record.data.length < 4) continue
        const nChars = record.data.readUInt32LE(0) & 0x7fffffff
        if (nChars <= 1) {
          pendingEmpty = { offset: record.offset }
        }
        continue
      }

      if (pendingEmpty && record.tagId === TAG.PARA_TEXT) {
        const isOnlyParaEnd = record.data.length === 2 && record.data.readUInt16LE(0) === 0x000d
        if (isOnlyParaEnd) {
          issues.push({ stream: stream.name, offset: pendingEmpty.offset })
        }
        pendingEmpty = null
      }
    }
  }

  if (issues.length > 0) {
    return {
      name: 'empty_paragraph_text',
      status: 'fail',
      message: `${issues.length} empty paragraph(s) contain PARA_TEXT with only the paragraph-end marker (0x000D); non-minimal encoding, not necessarily corruption`,
      details: {
        issueCount: issues.length,
        examples: issues.slice(0, 5),
      },
    }
  }

  return { name: 'empty_paragraph_text', status: 'pass' }
}

const TABLE_CTRL_HEADER_MIN_SIZE = 44
const TABLE_RECORD_BASE_SIZE = 18
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

      if (record.tagId === TAG.CTRL_HEADER && record.data.length >= 4) {
        const controlType = readControlId(record.data)
        if (controlType === 'tbl ') {
          if (tableCtrlLevel !== null && record.level > tableCtrlLevel) {
            continue
          }

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
          } else if (record.data.length >= 24) {
            const width = record.data.readUInt32LE(16)
            const height = record.data.readUInt32LE(20)
            if (width === 0 && height === 0) {
              issues.push(
                `${stream.name} table CTRL_HEADER at record ${i}: zero dimensions (width=${width}, height=${height})`,
              )
            }
          }
          continue
        }

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

      if (record.tagId === TAG.TABLE && record.level === tableCtrlLevel + 1) {
        if (record.data.length < TABLE_RECORD_BASE_SIZE) {
          issues.push(
            `${stream.name} TABLE record at record ${i}: size ${record.data.length} < minimum ${TABLE_RECORD_BASE_SIZE}`,
          )
        }
        if (record.data.length >= 8) {
          const rows = record.data.readUInt16LE(4)
          const cols = record.data.readUInt16LE(6)
          const dynamicMinSize = TABLE_RECORD_BASE_SIZE + rows * 2
          if (record.data.length < dynamicMinSize) {
            issues.push(
              `${stream.name} TABLE record at record ${i}: size ${record.data.length} < required ${dynamicMinSize} for ${rows} rows`,
            )
            expectedCellCount = rows * cols
          } else if (rows > 0) {
            let allZero = true
            for (let r = 0; r < rows; r++) {
              const cellsInRow = record.data.readUInt16LE(TABLE_RECORD_BASE_SIZE + r * 2)
              if (cellsInRow > 0) allZero = false
              expectedCellCount += cellsInRow
            }
            if (allZero && cols > 0) {
              issues.push(
                `${stream.name} TABLE record at record ${i}: rowSpanCounts are all zero (${rows} rows, ${cols} cols)`,
              )
            }
          }
        }
        continue
      }

      if (record.tagId === TAG.LIST_HEADER && record.level === tableCtrlLevel + 1) {
        gridCoverage += 1
        if (record.data.length < TABLE_CELL_LIST_HEADER_MIN_SIZE) {
          issues.push(
            `${stream.name} cell LIST_HEADER at record ${i}: size ${record.data.length} < minimum ${TABLE_CELL_LIST_HEADER_MIN_SIZE}`,
          )
        }
        if (record.data.length >= 24) {
          const cellWidth = record.data.readUInt32LE(16)
          const cellHeight = record.data.readUInt32LE(20)
          if (cellWidth === 0 && cellHeight === 0) {
            issues.push(
              `${stream.name} cell LIST_HEADER at record ${i}: zero dimensions (width=${cellWidth}, height=${cellHeight})`,
            )
          }
        }
      }

      if (issues.length >= 10) {
        break
      }
    }

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

function collectDeclaredFontCount(idMappingsData: Buffer): number | null {
  const fontOffsets = [4, 8, 12, 16, 20, 24, 28]
  if (fontOffsets.some((offset) => offset + 4 > idMappingsData.length)) {
    return null
  }

  return fontOffsets.reduce((sum, offset) => sum + idMappingsData.readUInt32LE(offset), 0)
}

function formatTagId(tagId: number): string {
  return `0x${tagId.toString(16).toUpperCase().padStart(2, '0')}`
}

function formatControlCode(code: number): string {
  return `0x${code.toString(16).toUpperCase().padStart(2, '0')}`
}

function getTagName(tagId: number): string {
  return Object.entries(TAG).find(([, value]) => value === tagId)?.[0] ?? formatTagId(tagId)
}

function findNearestLowerLevel(levels: number[], currentLevel: number): number | null {
  for (let index = levels.length - 1; index >= 0; index--) {
    if (levels[index] < currentLevel) {
      return levels[index]
    }
  }

  return null
}

function findNearestParagraphLevel(levels: number[], currentLevel: number): number | null {
  for (let index = levels.length - 1; index >= 0; index--) {
    if (levels[index] <= currentLevel) {
      return levels[index]
    }
  }

  return null
}

function findNearestCtrlHeader(
  ctrlHeaders: Array<{ level: number; controlType: string | null }>,
  currentLevel: number,
): { level: number; controlType: string | null } | null {
  for (let index = ctrlHeaders.length - 1; index >= 0; index--) {
    if (ctrlHeaders[index].level < currentLevel) {
      return ctrlHeaders[index]
    }
  }

  return null
}

function isCompatTrailingControl(
  records: ParsedRecord[],
  recordIndex: number,
  position: number,
  code: number,
): boolean {
  if (code !== 0x0b || position !== 0 || records[recordIndex]?.data.length !== 2) {
    return false
  }

  const level = records[recordIndex].level
  for (let i = recordIndex + 1; i < records.length; i++) {
    const record = records[i]
    if (record.tagId === TAG.PARA_HEADER && record.level <= level) {
      return false
    }

    if (record.tagId === TAG.CTRL_HEADER && record.level === level) {
      return true
    }
  }

  return false
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
