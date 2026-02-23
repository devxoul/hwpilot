export type DaemonRequest = {
  token: string
  command: string
  args: Record<string, unknown>
}

export type DaemonResponse =
  | { success: true; data: unknown }
  | { success: false; error: string; context?: unknown; hint?: string }

const MAX_MESSAGE_SIZE = 64 * 1024 * 1024 // 64 MB

export function encodeMessage(obj: unknown): Buffer {
  const json = JSON.stringify(obj)
  const body = Buffer.from(json, 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32BE(body.length, 0)
  return Buffer.concat([header, body])
}

export function createMessageReader(
  callback: (msg: unknown) => void,
): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0)

  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])

    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0)

      if (length > MAX_MESSAGE_SIZE) {
        buffer = Buffer.alloc(0)
        throw new Error(`Message too large: ${length} bytes`)
      }

      if (buffer.length < 4 + length) {
        break // wait for more data
      }

      const body = buffer.subarray(4, 4 + length)
      buffer = buffer.subarray(4 + length)
      const parsed = JSON.parse(body.toString('utf8'))
      callback(parsed)
    }
  }
}
