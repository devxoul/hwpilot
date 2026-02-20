import { afterEach, describe, expect, it } from 'bun:test'
import CFB from 'cfb'
import { extractParaText, loadHwp } from './reader'

const TMP_FILES: string[] = []

afterEach(async () => {
  await Promise.all(
    TMP_FILES.splice(0).map(async (file) => {
      await Bun.file(file).delete()
    }),
  )
})

describe('loadHwp', () => {
  it('throws for invalid signature', async () => {
    const filePath = '/tmp/test-invalid-signature.hwp'
    TMP_FILES.push(filePath)
    const buffer = createHwpCfbBuffer(0, 'Not HWP Signature')
    await Bun.write(filePath, buffer)

    await expect(loadHwp(filePath)).rejects.toThrow('Invalid HWP file: wrong signature')
  })

  it('throws for encrypted files', async () => {
    const filePath = '/tmp/test-encrypted.hwp'
    TMP_FILES.push(filePath)
    const buffer = createHwpCfbBuffer(0x1, 'HWP Document File')
    await Bun.write(filePath, buffer)

    await expect(loadHwp(filePath)).rejects.toThrow('Password-protected files not supported')
  })

  it('exports expected public functions', () => {
    expect(typeof loadHwp).toBe('function')
    expect(typeof extractParaText).toBe('function')
  })
})

describe('extractParaText', () => {
  it('extracts UTF-16LE text and skips inline control payload', () => {
    const data = encodeUint16([
      0x0041, 0x0001, 0x1111, 0x2222, 0x3333, 0x4444, 0x5555, 0x6666, 0x7777, 0x0042, 0x0009, 0x0043, 0x0000,
    ])

    expect(extractParaText(data)).toBe('ABC')
  })
})

function createHwpCfbBuffer(flags: number, signature: string): Buffer {
  const cfb = CFB.utils.cfb_new()
  const fileHeader = Buffer.alloc(256)
  fileHeader.write(signature, 0, 'ascii')
  fileHeader.writeUInt32LE(flags, 36)

  CFB.utils.cfb_add(cfb, 'FileHeader', fileHeader)
  CFB.utils.cfb_add(cfb, 'DocInfo', Buffer.alloc(0))

  return Buffer.from(CFB.write(cfb, { type: 'buffer' }))
}

function encodeUint16(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2)
  for (const [index, value] of values.entries()) {
    buffer.writeUInt16LE(value, index * 2)
  }
  return buffer
}
