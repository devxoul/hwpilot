import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import CFB from 'cfb'
import { createTestHwpBinary, createTestHwpCfb, createTestHwpx } from '../../test-helpers'
import { controlIdBuffer } from './control-id'
import { iterateRecords } from './record-parser'
import { buildCellListHeaderData, buildRecord, buildTableData, replaceRecordData } from './record-serializer'
import { TAG } from './tag-ids'
import { validateHwp, validateHwpBuffer } from './validator'

const TMP_FILES: string[] = []

afterEach(async () => {
  await Promise.all(
    TMP_FILES.splice(0).map(async (filePath) => {
      await Bun.file(filePath).delete()
    }),
  )
})

describe('validateHwp', () => {
  describe('Section A — Layer 1: CFB + FileHeader', () => {
    it('validates clean uncompressed HWP file', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-a-clean')

      const result = await validateHwp(filePath)

      expect(result.valid).toBe(true)
      expect(result.format).toBe('hwp')
      expect(getCheckStatus(result, 'cfb_structure')).toBe('pass')
    })

    it('validates clean compressed HWP file', async () => {
      const filePath = await writeTempHwp(
        await createTestHwpBinary({ paragraphs: ['hello'], compressed: true }),
        'validator-a-clean-compressed',
      )

      const result = await validateHwp(filePath)

      expect(result.valid).toBe(true)
      expect(result.format).toBe('hwp')
      expect(getCheckStatus(result, 'cfb_structure')).toBe('pass')
    })

    it('rejects non-HWP file', async () => {
      const filePath = await writeTempHwp(Buffer.from('not a hwp file'), 'validator-a-not-hwp')

      const result = await validateHwp(filePath)

      expect(result.valid).toBe(false)
      expect(getCheckStatus(result, 'file_format')).toBe('fail')
    })

    it('rejects file with invalid signature', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-a-signature')

      await patchFileHeader(filePath, (header) => {
        header.write('BAD Signature File', 0, 'ascii')
      })

      const result = await validateHwp(filePath)

      expect(result.valid).toBe(false)
      expect(getCheckStatus(result, 'cfb_structure')).toBe('fail')
      expect(getCheckMessage(result, 'cfb_structure')).toContain('Invalid HWP signature')
    })

    it('reports HWPX as valid with skip', async () => {
      const filePath = await writeTempHwp(await createTestHwpx({ paragraphs: ['hello'] }), 'validator-a-hwpx')

      const result = await validateHwp(filePath)

      expect(result.valid).toBe(true)
      expect(result.format).toBe('hwpx')
      expect(result.checks).toHaveLength(0)
    })

    it('rejects password-protected file', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-a-encrypted')

      await patchFileHeader(filePath, (header) => {
        const flags = header.readUInt32LE(36)
        header.writeUInt32LE(flags | 0x2, 36)
      })

      const result = await validateHwp(filePath)

      expect(result.valid).toBe(false)
      expect(getCheckStatus(result, 'cfb_structure')).toBe('fail')
      expect(getCheckMessage(result, 'cfb_structure')).toContain('Password-protected')
    })

    it('rejects file with missing DocInfo', async () => {
      const fileHeader = getEntryContent(CFB.read(createTestHwpCfb(), { type: 'buffer' }), '/FileHeader')
      const section0 = await getSection0FromValidFixture()

      const cfb = CFB.utils.cfb_new()
      CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
      CFB.utils.cfb_add(cfb, 'BodyText/Section0', section0)

      const filePath = await writeTempHwp(
        Buffer.from(CFB.write(cfb, { type: 'buffer' })),
        'validator-a-missing-docinfo',
      )
      const result = await validateHwp(filePath)

      expect(result.valid).toBe(false)
      expect(getCheckStatus(result, 'cfb_structure')).toBe('fail')
      expect(getCheckMessage(result, 'cfb_structure')).toContain('Missing DocInfo')
    })

    it('rejects file with missing Section0', async () => {
      const filePath = await writeTempHwp(createTestHwpCfb(), 'validator-a-missing-section0')

      const result = await validateHwp(filePath)

      expect(result.valid).toBe(false)
      expect(getCheckStatus(result, 'cfb_structure')).toBe('fail')
      expect(getCheckMessage(result, 'cfb_structure')).toContain('Missing BodyText/Section0')
    })
  })

  describe('Section B — Layer 2: Record Stream Integrity', () => {
    it('detects truncated section stream', async () => {
      const base = await createTestHwpBinary({ paragraphs: ['hello'] })
      const cfb = CFB.read(base, { type: 'buffer' })
      const section0 = getEntryContent(cfb, '/BodyText/Section0')
      const packed = section0.readUInt32LE(0)
      const brokenHeader = ((packed & 0x000fffff) | (0xffe << 20)) >>> 0
      section0.writeUInt32LE(brokenHeader, 0)

      const filePath = await writeTempHwp(await buildHwpWithCustomSection0(section0), 'validator-b-truncated')

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'record_stream')).toBe('fail')
      expect(getCheckMessage(result, 'record_stream')).toContain('Truncated record')
    })

    it('detects leftover bytes after records', async () => {
      const base = await createTestHwpBinary({ paragraphs: ['hello'] })
      const cfb = CFB.read(base, { type: 'buffer' })
      const section0 = getEntryContent(cfb, '/BodyText/Section0')
      const withGarbage = Buffer.concat([section0, Buffer.from([0xde, 0xad, 0xbe])])

      const filePath = await writeTempHwp(await buildHwpWithCustomSection0(withGarbage), 'validator-b-leftover')

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'record_stream')).toBe('fail')
    })

    it('passes on valid record stream', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-b-valid')

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'record_stream')).toBe('pass')
    })

    it('handles compressed stream correctly', async () => {
      const filePath = await writeTempHwp(
        await createTestHwpBinary({ paragraphs: ['hello'], compressed: true }),
        'validator-b-compressed',
      )

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'record_stream')).toBe('pass')
    })
  })

  describe('Section C — Layer 3: nChars Consistency', () => {
    it('passes when nChars matches PARA_TEXT length', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-c-pass')

      await patchNthParaHeader(filePath, 0, (headerData) => {
        const nChars = headerData.readUInt32LE(0) & 0x7fffffff
        headerData.writeUInt32LE((nChars | 0x80000000) >>> 0, 0)
        return headerData
      })

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'nchars_consistency')).toBe('pass')
    })

    it('detects nChars mismatch', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-c-mismatch')

      await patchNthParaHeader(filePath, 0, (headerData) => {
        headerData.writeUInt32LE((0x80000000 | 999) >>> 0, 0)
        return headerData
      })

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'nchars_consistency')).toBe('fail')
      expect(getCheckMessage(result, 'nchars_consistency')).toContain('mismatch')
    })

    it('handles empty paragraph without PARA_TEXT', async () => {
      const base = await createTestHwpBinary({ paragraphs: ['seed'] })
      const baseCfb = CFB.read(base, { type: 'buffer' })
      const fileHeader = getEntryContent(baseCfb, '/FileHeader')
      const docInfo = getEntryContent(baseCfb, '/DocInfo')

      const paraHeader = Buffer.alloc(24)
      paraHeader.writeUInt32LE(0x80000000, 0)
      const section0 = buildRecord(TAG.PARA_HEADER, 0, paraHeader)

      const cfb = CFB.utils.cfb_new()
      CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
      CFB.utils.cfb_add(cfb, 'DocInfo', docInfo)
      CFB.utils.cfb_add(cfb, 'BodyText/Section0', section0)

      const filePath = await writeTempHwp(Buffer.from(CFB.write(cfb, { type: 'buffer' })), 'validator-c-empty')
      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'nchars_consistency')).toBe('pass')
    })

    it('detects multiple last-paragraph bits', async () => {
      const filePath = await writeTempHwp(
        await createTestHwpBinary({ paragraphs: ['a', 'b'] }),
        'validator-c-multi-last',
      )

      await patchNthParaHeader(filePath, 0, (headerData) => {
        const value = headerData.readUInt32LE(0)
        headerData.writeUInt32LE((value | 0x80000000) >>> 0, 0)
        return headerData
      })
      await patchNthParaHeader(filePath, 1, (headerData) => {
        const value = headerData.readUInt32LE(0)
        headerData.writeUInt32LE((value | 0x80000000) >>> 0, 0)
        return headerData
      })

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'nchars_consistency')).toBe('warn')
      expect(getCheckMessage(result, 'nchars_consistency')).toContain('Multiple last-paragraph bits')
    })

    it('detects missing last-paragraph bit', async () => {
      const filePath = await writeTempHwp(
        await createTestHwpBinary({ paragraphs: ['hello'] }),
        'validator-c-missing-last',
      )

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'nchars_consistency')).toBe('warn')
      expect(getCheckMessage(result, 'nchars_consistency')).toContain('No last-paragraph bit set')
    })
  })

  describe('Section D — Layer 4: Cross-Reference Bounds', () => {
    it('passes with valid references', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-d-pass')

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'cross_references')).toBe('pass')
    })

    it('detects out-of-bounds charShapeRef', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-d-charshape')

      await patchFirstParaCharShapeRef(filePath, 999)

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'cross_references')).toBe('fail')
      expect(getCheckMessage(result, 'cross_references')).toContain('PARA_CHAR_SHAPE ref out of bounds')
    })

    it('detects out-of-bounds paraShapeRef', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-d-parashape')

      await patchNthParaHeader(filePath, 0, (headerData) => {
        headerData.writeUInt16LE(999, 8)
        return headerData
      })

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'cross_references')).toBe('fail')
      expect(getCheckMessage(result, 'cross_references')).toContain('paraShapeRef out of bounds')
    })

    it('detects out-of-bounds fontRef in CharShape', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-d-font')

      await patchFirstCharShapeFontRef(filePath, 999)

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'cross_references')).toBe('fail')
      expect(getCheckMessage(result, 'cross_references')).toContain('fontRef out of bounds')
    })
  })

  describe('Section E — Layer 5: ID_MAPPINGS Consistency', () => {
    it('passes when counts match', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-e-pass')

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'id_mappings')).toBe('pass')
    })

    it('detects charShape count mismatch', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-e-mismatch')

      await patchIdMappingsCharShapeCount(filePath, 999)

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'id_mappings')).toBe('fail')
      expect(getCheckMessage(result, 'id_mappings')).toContain('charShape mismatch')
    })
  })

  describe('Section F — Layer 6: Content Completeness', () => {
    it('passes on fixture file with full charShape coverage', async () => {
      // e2e/fixtures/폭행죄(고소장).hwp has 25 declared charShapes, 100% referenced in body
      const result = await validateHwp('e2e/fixtures/폭행죄(고소장).hwp')

      expect(getCheckStatus(result, 'content_completeness')).toBe('pass')
    })

    it('detects truncated section content with low charShape coverage', async () => {
      // README-corrupted.hwp has 86 declared charShapes but body references only charShape index 0
      const result = await validateHwp('e2e/fixtures/README-corrupted.hwp')

      expect(getCheckStatus(result, 'content_completeness')).toBe('fail')
      expect(getCheckMessage(result, 'content_completeness')).toContain('charShapes')
    })

    it('skips check when declared charShape count is below threshold', async () => {
      // createTestHwpBinary creates exactly 1 CHAR_SHAPE record in DocInfo (well below threshold of 10)
      const filePath = await writeTempHwp(
        await createTestHwpBinary({ paragraphs: ['hello'] }),
        'validator-f-below-threshold',
      )

      const result = await validateHwp(filePath)

      // Guard kicks in: 1 < 10 → check skipped → pass
      expect(getCheckStatus(result, 'content_completeness')).toBe('pass')
    })
  })

  describe('Section G — Layer 7: Paragraph Completeness', () => {
    it('passes when all paragraphs have complete sub-records', async () => {
      const paraHeader = Buffer.alloc(24)
      paraHeader.writeUInt32LE((0x80000000 | 3) >>> 0, 0)

      const section0 = Buffer.concat([
        buildRecord(TAG.PARA_HEADER, 0, paraHeader),
        buildRecord(TAG.PARA_TEXT, 1, Buffer.from('abc', 'utf16le')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 1, Buffer.alloc(8)),
        buildRecord(TAG.PARA_LINE_SEG, 1, Buffer.alloc(36)),
      ])

      const filePath = await writeTempHwp(await buildHwpWithCustomSection0(section0), 'validator-g-pass')
      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'paragraph_completeness')).toBe('pass')
    })

    it('detects missing PARA_CHAR_SHAPE in table cell paragraph', async () => {
      // Build a section with a table cell paragraph that has PARA_TEXT but no PARA_CHAR_SHAPE
      const paraHeader = Buffer.alloc(24)
      paraHeader.writeUInt32LE(3, 0) // nChars = 3

      const cellParaHeader = Buffer.alloc(24)
      cellParaHeader.writeUInt32LE((0x80000000 | 2) >>> 0, 0) // nChars = 2, last bit

      const section0 = Buffer.concat([
        // Normal paragraph with char shape (valid)
        buildRecord(TAG.PARA_HEADER, 0, paraHeader),
        buildRecord(TAG.PARA_TEXT, 1, Buffer.from('abc', 'utf16le')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 1, Buffer.alloc(8)),
        buildRecord(TAG.PARA_LINE_SEG, 1, Buffer.alloc(36)),
        // Table cell paragraph missing PARA_CHAR_SHAPE (invalid)
        buildRecord(TAG.PARA_HEADER, 3, cellParaHeader),
        buildRecord(TAG.PARA_TEXT, 3, Buffer.from('hi', 'utf16le')),
      ])

      const filePath = await writeTempHwp(await buildHwpWithCustomSection0(section0), 'validator-g-missing-charshape')
      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'paragraph_completeness')).toBe('fail')
      expect(getCheckMessage(result, 'paragraph_completeness')).toContain('missing PARA_CHAR_SHAPE')
    })

    it('fails on missing PARA_LINE_SEG when PARA_CHAR_SHAPE present', async () => {
      const paraHeader = Buffer.alloc(24)
      paraHeader.writeUInt32LE((0x80000000 | 3) >>> 0, 0)

      const section0 = Buffer.concat([
        buildRecord(TAG.PARA_HEADER, 0, paraHeader),
        buildRecord(TAG.PARA_TEXT, 1, Buffer.from('abc', 'utf16le')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 1, Buffer.alloc(8)),
        // No PARA_LINE_SEG
      ])

      const filePath = await writeTempHwp(await buildHwpWithCustomSection0(section0), 'validator-g-missing-lineseg')
      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'paragraph_completeness')).toBe('fail')
      expect(getCheckMessage(result, 'paragraph_completeness')).toContain('missing PARA_LINE_SEG')
    })

    it('passes on empty paragraph without PARA_TEXT', async () => {
      const section0 = Buffer.concat([buildRecord(TAG.PARA_HEADER, 0, Buffer.alloc(24))])

      const filePath = await writeTempHwp(await buildHwpWithCustomSection0(section0), 'validator-g-empty')
      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'paragraph_completeness')).toBe('pass')
    })

    it('detects corruption in README-corrupted.hwp (real file)', async () => {
      const result = await validateHwp('e2e/fixtures/README-corrupted.hwp')

      expect(getCheckStatus(result, 'content_completeness')).toBe('fail')
    })

    it('passes on valid fixture with tables', async () => {
      const result = await validateHwp('e2e/fixtures/폭행죄(고소장).hwp')

      expect(getCheckStatus(result, 'paragraph_completeness')).toBe('pass')
    })
  })

  describe('Section G — Buffer validation', () => {
    it('validateHwpBuffer(validBuffer) returns { valid: true }', async () => {
      const buffer = await createTestHwpBinary({ paragraphs: ['hello'] })

      const result = await validateHwpBuffer(buffer)

      expect(result.valid).toBe(true)
      expect(result.format).toBe('hwp')
      expect(result.file).toBe('<buffer>')
      expect(result.checks.length).toBeGreaterThan(0)
    })

    it('validateHwpBuffer(corruptedBuffer) returns { valid: false }', async () => {
      const base = await createTestHwpBinary({ paragraphs: ['hello'] })
      const cfb = CFB.read(base, { type: 'buffer' })
      const section0 = getEntryContent(cfb, '/BodyText/Section0')
      const truncated = section0.subarray(0, Math.floor(section0.length / 2))

      const buffer = await buildHwpWithCustomSection0(truncated)

      const result = await validateHwpBuffer(buffer)

      expect(result.valid).toBe(false)
      expect(result.format).toBe('hwp')
      expect(result.file).toBe('<buffer>')
      expect(result.checks.some((c) => c.status === 'fail')).toBe(true)
    })

    it('validateHwpBuffer and validateHwp return same results (excluding file field)', async () => {
      const buffer = await createTestHwpBinary({ paragraphs: ['hello'] })
      const filePath = await writeTempHwp(buffer, 'validator-g-compare')

      const bufferResult = await validateHwpBuffer(buffer)
      const fileResult = await validateHwp(filePath)

      expect(bufferResult.valid).toBe(fileResult.valid)
      expect(bufferResult.format).toBe(fileResult.format)
      expect(bufferResult.checks.length).toBe(fileResult.checks.length)
      expect(bufferResult.file).toBe('<buffer>')
      expect(fileResult.file).toBe(filePath)
    })

    it('validateHwpBuffer(compressedBuffer) returns { valid: true }', async () => {
      const buffer = await createTestHwpBinary({ paragraphs: ['hello'], compressed: true })

      const result = await validateHwpBuffer(buffer)

      expect(result.valid).toBe(true)
      expect(result.format).toBe('hwp')
      expect(result.file).toBe('<buffer>')
      expect(result.checks.length).toBeGreaterThan(0)
    })
  })

  describe('Section H — Layer 8: Table Structure', () => {
    it('passes on valid fixture with proper tables', async () => {
      const result = await validateHwp('e2e/fixtures/폭행죄(고소장).hwp')

      expect(getCheckStatus(result, 'table_structure')).toBe('pass')
    })

    it('passes on file without any tables', async () => {
      const filePath = await writeTempHwp(await createTestHwpBinary({ paragraphs: ['hello'] }), 'validator-h-no-tables')

      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'table_structure')).toBe('pass')
    })

    it('detects truncated CTRL_HEADER for table control', async () => {
      // Build section with a table CTRL_HEADER that only has the 4-byte control ID
      // (our broken table add produces this — real tables need >= 44 bytes)
      const paraHeader = Buffer.alloc(24)
      paraHeader.writeUInt32LE((0x80000000 | 1) >>> 0, 0)

      const tableParaCharShape = Buffer.alloc(8)
      const tableParaLineSeg = Buffer.alloc(36)

      const section0 = Buffer.concat([
        buildRecord(TAG.PARA_HEADER, 0, paraHeader),
        buildRecord(TAG.PARA_TEXT, 1, Buffer.from('\x0b\x00', 'binary')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 1, tableParaCharShape),
        buildRecord(TAG.PARA_LINE_SEG, 1, tableParaLineSeg),
        // Truncated table CTRL_HEADER — only 4 bytes (control ID)
        buildRecord(TAG.CTRL_HEADER, 1, controlIdBuffer('tbl ')),
        buildRecord(TAG.TABLE, 2, buildTableData(1, 1)),
        buildRecord(TAG.LIST_HEADER, 2, buildCellListHeaderData(0, 0, 1, 1)),
        buildRecord(TAG.PARA_HEADER, 3, paraHeader),
        buildRecord(TAG.PARA_TEXT, 3, Buffer.from('A', 'utf16le')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 3, tableParaCharShape),
        buildRecord(TAG.PARA_LINE_SEG, 3, tableParaLineSeg),
      ])

      const filePath = await writeTempHwp(await buildHwpWithCustomSection0(section0), 'validator-h-truncated-ctrl')
      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'table_structure')).toBe('fail')
      expect(getCheckMessage(result, 'table_structure')).toContain('CTRL_HEADER')
    })

    it('detects truncated TABLE record', async () => {
      // Build section with TABLE record that only has 8 bytes instead of >= 34
      const paraHeader = Buffer.alloc(24)
      paraHeader.writeUInt32LE((0x80000000 | 1) >>> 0, 0)

      const tableParaCharShape = Buffer.alloc(8)
      const tableParaLineSeg = Buffer.alloc(36)
      // Full 44-byte CTRL_HEADER (enough to pass the ctrl header check)
      const fullCtrlHeader = Buffer.alloc(44)
      controlIdBuffer('tbl ').copy(fullCtrlHeader, 0)

      const section0 = Buffer.concat([
        buildRecord(TAG.PARA_HEADER, 0, paraHeader),
        buildRecord(TAG.PARA_TEXT, 1, Buffer.from('\x0b\x00', 'binary')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 1, tableParaCharShape),
        buildRecord(TAG.PARA_LINE_SEG, 1, tableParaLineSeg),
        buildRecord(TAG.CTRL_HEADER, 1, fullCtrlHeader),
        // Truncated TABLE record — only 8 bytes (intentionally small for test)
        buildRecord(TAG.TABLE, 2, Buffer.alloc(8)),
        buildRecord(TAG.LIST_HEADER, 2, buildCellListHeaderData(0, 0, 1, 1)),
        buildRecord(TAG.PARA_HEADER, 3, paraHeader),
        buildRecord(TAG.PARA_TEXT, 3, Buffer.from('A', 'utf16le')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 3, tableParaCharShape),
        buildRecord(TAG.PARA_LINE_SEG, 3, tableParaLineSeg),
      ])

      const filePath = await writeTempHwp(await buildHwpWithCustomSection0(section0), 'validator-h-truncated-table')
      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'table_structure')).toBe('fail')
      expect(getCheckMessage(result, 'table_structure')).toContain('TABLE record')
    })

    it('detects truncated cell LIST_HEADER', async () => {
      // Build section with cell LIST_HEADER that only has 32 bytes instead of >= 46
      const paraHeader = Buffer.alloc(24)
      paraHeader.writeUInt32LE((0x80000000 | 1) >>> 0, 0)

      const tableParaCharShape = Buffer.alloc(8)
      const tableParaLineSeg = Buffer.alloc(36)
      const fullCtrlHeader = Buffer.alloc(44)
      controlIdBuffer('tbl ').copy(fullCtrlHeader, 0)
      // Full TABLE record (34 bytes)
      const fullTableData = Buffer.alloc(34)
      fullTableData.writeUInt16LE(1, 4) // rows
      fullTableData.writeUInt16LE(1, 6) // cols

      const section0 = Buffer.concat([
        buildRecord(TAG.PARA_HEADER, 0, paraHeader),
        buildRecord(TAG.PARA_TEXT, 1, Buffer.from('\x0b\x00', 'binary')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 1, tableParaCharShape),
        buildRecord(TAG.PARA_LINE_SEG, 1, tableParaLineSeg),
        buildRecord(TAG.CTRL_HEADER, 1, fullCtrlHeader),
        buildRecord(TAG.TABLE, 2, fullTableData),
        // Truncated cell LIST_HEADER — only 32 bytes (intentionally small for test)
        buildRecord(TAG.LIST_HEADER, 2, Buffer.alloc(32)),
        buildRecord(TAG.PARA_HEADER, 3, paraHeader),
        buildRecord(TAG.PARA_TEXT, 3, Buffer.from('A', 'utf16le')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 3, tableParaCharShape),
        buildRecord(TAG.PARA_LINE_SEG, 3, tableParaLineSeg),
      ])

      const filePath = await writeTempHwp(
        await buildHwpWithCustomSection0(section0),
        'validator-h-truncated-listheader',
      )
      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'table_structure')).toBe('fail')
      expect(getCheckMessage(result, 'table_structure')).toContain('LIST_HEADER')
    })

    it('detects cell count mismatch', async () => {
      // Build section with TABLE declaring 2x2=4 cells but only 2 LIST_HEADER records
      const paraHeader = Buffer.alloc(24)
      paraHeader.writeUInt32LE((0x80000000 | 1) >>> 0, 0)

      const tableParaCharShape = Buffer.alloc(8)
      const tableParaLineSeg = Buffer.alloc(36)
      const fullCtrlHeader = Buffer.alloc(44)
      controlIdBuffer('tbl ').copy(fullCtrlHeader, 0)
      const fullTableData = Buffer.alloc(34)
      fullTableData.writeUInt16LE(2, 4) // rows
      fullTableData.writeUInt16LE(2, 6) // cols → expects 4 cells

      // Full-size LIST_HEADER (46 bytes)
      const fullCellHeader = Buffer.alloc(46)
      fullCellHeader.writeInt32LE(1, 0)
      fullCellHeader.writeUInt16LE(0, 8) // col
      fullCellHeader.writeUInt16LE(0, 10) // row
      fullCellHeader.writeUInt16LE(1, 12) // colSpan
      fullCellHeader.writeUInt16LE(1, 14) // rowSpan

      const section0 = Buffer.concat([
        buildRecord(TAG.PARA_HEADER, 0, paraHeader),
        buildRecord(TAG.PARA_TEXT, 1, Buffer.from('\x0b\x00', 'binary')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 1, tableParaCharShape),
        buildRecord(TAG.PARA_LINE_SEG, 1, tableParaLineSeg),
        buildRecord(TAG.CTRL_HEADER, 1, fullCtrlHeader),
        buildRecord(TAG.TABLE, 2, fullTableData),
        // Only 2 cells instead of 4
        buildRecord(TAG.LIST_HEADER, 2, fullCellHeader),
        buildRecord(TAG.PARA_HEADER, 3, paraHeader),
        buildRecord(TAG.PARA_TEXT, 3, Buffer.from('A', 'utf16le')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 3, tableParaCharShape),
        buildRecord(TAG.PARA_LINE_SEG, 3, tableParaLineSeg),
        buildRecord(TAG.LIST_HEADER, 2, fullCellHeader),
        buildRecord(TAG.PARA_HEADER, 3, paraHeader),
        buildRecord(TAG.PARA_TEXT, 3, Buffer.from('B', 'utf16le')),
        buildRecord(TAG.PARA_CHAR_SHAPE, 3, tableParaCharShape),
        buildRecord(TAG.PARA_LINE_SEG, 3, tableParaLineSeg),
      ])

      const filePath = await writeTempHwp(await buildHwpWithCustomSection0(section0), 'validator-h-cell-count')
      const result = await validateHwp(filePath)

      expect(getCheckStatus(result, 'table_structure')).toBe('fail')
      expect(getCheckMessage(result, 'table_structure')).toContain('expected grid coverage 4')
    })
  })
})

function tmpPath(name: string): string {
  return `/tmp/${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.hwp`
}

async function writeTempHwp(content: Buffer, name: string): Promise<string> {
  const filePath = tmpPath(name)
  TMP_FILES.push(filePath)
  await Bun.write(filePath, content)
  return filePath
}

async function patchFileHeader(filePath: string, mutate: (header: Buffer) => void): Promise<void> {
  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const fileHeaderEntry = CFB.find(cfb, '/FileHeader')
  if (!fileHeaderEntry?.content) {
    throw new Error('FileHeader not found')
  }

  const header = Buffer.from(fileHeaderEntry.content)
  mutate(header)
  fileHeaderEntry.content = header
  await Bun.write(filePath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
}

async function patchSection0(filePath: string, mutate: (section0: Buffer) => Buffer): Promise<void> {
  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const sectionEntry = CFB.find(cfb, '/BodyText/Section0')
  if (!sectionEntry?.content) {
    throw new Error('Section0 not found')
  }

  const nextSection0 = mutate(Buffer.from(sectionEntry.content))
  sectionEntry.content = nextSection0
  await Bun.write(filePath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
}

async function patchNthParaHeader(
  filePath: string,
  paragraphIndex: number,
  mutate: (headerData: Buffer) => Buffer,
): Promise<void> {
  await patchSection0(filePath, (section0) => {
    let paraCursor = -1
    for (const { header, data, offset } of iterateRecords(section0)) {
      if (header.tagId !== TAG.PARA_HEADER || header.level !== 0) {
        continue
      }
      paraCursor += 1
      if (paraCursor !== paragraphIndex) {
        continue
      }

      const nextData = mutate(Buffer.from(data))
      return replaceRecordData(section0, offset, nextData)
    }

    throw new Error(`PARA_HEADER not found for paragraph ${paragraphIndex}`)
  })
}

async function patchFirstParaCharShapeRef(filePath: string, nextRef: number): Promise<void> {
  await patchSection0(filePath, (section0) => {
    for (const { header, data, offset } of iterateRecords(section0)) {
      if (header.tagId !== TAG.PARA_CHAR_SHAPE) {
        continue
      }

      const nextData = Buffer.from(data)
      if (nextData.length >= 8 && nextData.length % 8 === 0) {
        nextData.writeUInt32LE(nextRef, 4)
      } else if (nextData.length >= 6) {
        nextData.writeUInt16LE(nextRef, 4)
      } else {
        throw new Error('PARA_CHAR_SHAPE record too short')
      }
      return replaceRecordData(section0, offset, nextData)
    }

    throw new Error('PARA_CHAR_SHAPE record not found')
  })
}

async function patchFirstCharShapeFontRef(filePath: string, nextRef: number): Promise<void> {
  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const docInfoEntry = CFB.find(cfb, '/DocInfo')
  if (!docInfoEntry?.content) {
    throw new Error('DocInfo not found')
  }

  const docInfo = Buffer.from(docInfoEntry.content)
  for (const { header, data, offset } of iterateRecords(docInfo)) {
    if (header.tagId !== TAG.CHAR_SHAPE) {
      continue
    }

    const nextData = Buffer.from(data)
    if (nextData.length < 2) {
      throw new Error('CHAR_SHAPE record too short')
    }
    nextData.writeUInt16LE(nextRef, 0)
    docInfoEntry.content = replaceRecordData(docInfo, offset, nextData)
    await Bun.write(filePath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
    return
  }

  throw new Error('CHAR_SHAPE record not found')
}

async function patchIdMappingsCharShapeCount(filePath: string, declaredCount: number): Promise<void> {
  const cfb = CFB.read(await readFile(filePath), { type: 'buffer' })
  const docInfoEntry = CFB.find(cfb, '/DocInfo')
  if (!docInfoEntry?.content) {
    throw new Error('DocInfo not found')
  }

  const docInfo = Buffer.from(docInfoEntry.content)
  for (const { header, data, offset } of iterateRecords(docInfo)) {
    if (header.tagId !== TAG.ID_MAPPINGS) {
      continue
    }

    const nextData = Buffer.from(data)
    if (nextData.length < 40) {
      throw new Error('ID_MAPPINGS record too short')
    }
    nextData.writeUInt32LE(declaredCount, 36)
    docInfoEntry.content = replaceRecordData(docInfo, offset, nextData)
    await Bun.write(filePath, Buffer.from(CFB.write(cfb, { type: 'buffer' })))
    return
  }

  throw new Error('ID_MAPPINGS record not found')
}

async function getSection0FromValidFixture(): Promise<Buffer> {
  const cfb = CFB.read(await createTestHwpBinary({ paragraphs: ['hello'] }), { type: 'buffer' })
  return getEntryContent(cfb, '/BodyText/Section0')
}

async function buildHwpWithCustomSection0(section0: Buffer): Promise<Buffer> {
  const base = CFB.read(await createTestHwpBinary({ paragraphs: ['hello'] }), { type: 'buffer' })
  const fileHeader = getEntryContent(base, '/FileHeader')
  const docInfo = getEntryContent(base, '/DocInfo')

  const cfb = CFB.utils.cfb_new()
  CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
  CFB.utils.cfb_add(cfb, 'DocInfo', docInfo)
  CFB.utils.cfb_add(cfb, 'BodyText/Section0', section0)
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}

function getEntryContent(cfb: CFB.CFB$Container, path: string): Buffer {
  const entry = CFB.find(cfb, path)
  if (!entry?.content) {
    throw new Error(`Entry not found: ${path}`)
  }
  return Buffer.from(entry.content)
}

function getCheckStatus(result: Awaited<ReturnType<typeof validateHwp>>, checkName: string) {
  const check = result.checks.find((item) => item.name === checkName)
  return check?.status
}

function getCheckMessage(result: Awaited<ReturnType<typeof validateHwp>>, checkName: string) {
  const check = result.checks.find((item) => item.name === checkName)
  return check?.message ?? ''
}
