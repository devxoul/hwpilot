// Reads 4 bytes at `offset` (default 0) in REVERSE order and joins as ASCII string.
// HWP 5.0 stores control type IDs with reversed byte order.
// Example: bytes [0x20, 0x6C, 0x62, 0x74] → reversed → [0x74, 0x62, 0x6C, 0x20] → 'tbl '
export function readControlId(data: Buffer, offset = 0): string {
  if (offset + 4 > data.length) return ''
  const bytes = data.subarray(offset, offset + 4)
  const reversed = Buffer.alloc(4)
  for (let i = 0; i < 4; i++) {
    reversed[i] = bytes[3 - i]
  }
  return reversed.toString('ascii')
}

// Returns a 4-byte Buffer with the logical name's bytes in REVERSED order.
// Example: 'tbl ' → chars [0x74, 0x62, 0x6C, 0x20] → reversed → [0x20, 0x6C, 0x62, 0x74]
export function controlIdBuffer(id: string): Buffer {
  if (id.length !== 4) throw new Error(`Control ID must be exactly 4 characters, got '${id}' (${id.length})`)
  const buffer = Buffer.alloc(4)
  for (let i = 0; i < 4; i++) {
    buffer[i] = id.charCodeAt(3 - i)
  }
  return buffer
}
