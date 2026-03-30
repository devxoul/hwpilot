import { deflateRaw, inflateRaw } from 'pako'

export function compressStream(buffer: Buffer): Buffer {
  return Buffer.from(deflateRaw(buffer))
}

export function decompressStream(buffer: Buffer): Buffer {
  return Buffer.from(inflateRaw(buffer))
}

export function getCompressionFlag(fileHeaderBuffer: Buffer): boolean {
  const flags = fileHeaderBuffer.readUInt32LE(36)
  return Boolean(flags & 0x1)
}

export function setCompressionFlag(fileHeaderBuffer: Buffer, compressed: boolean): void {
  const flags = fileHeaderBuffer.readUInt32LE(36)
  const updated = compressed ? flags | 0x1 : flags & ~0x1
  fileHeaderBuffer.writeUInt32LE(updated, 36)
}
