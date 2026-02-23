export type DaemonRequest = {
  token: string
  command: string
  args: Record<string, unknown>
}

export type DaemonResponse =
  | { success: true; data: unknown }
  | { success: false; error: string; context?: unknown; hint?: string }

/**
 * Encodes a message as: 4-byte uint32 BE length prefix + UTF-8 JSON
 */
export function encodeMessage(obj: unknown): Buffer {
  const json = JSON.stringify(obj)
  const utf8 = Buffer.from(json, 'utf-8')
  const lengthPrefix = Buffer.alloc(4)
  lengthPrefix.writeUInt32BE(utf8.length, 0)
  return Buffer.concat([lengthPrefix, utf8])
}

/**
 * Creates a message reader that buffers TCP chunks and emits complete messages.
 * Returns a function that processes incoming Buffer chunks.
 */
export function createMessageReader(callback: (msg: unknown) => void): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0)

  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])

    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0)

      if (buffer.length < 4 + length) {
        break
      }

      const messageBuffer = buffer.slice(4, 4 + length)
      const json = messageBuffer.toString('utf-8')
      const message = JSON.parse(json)
      callback(message)

      buffer = buffer.slice(4 + length)
    }
  }
}
