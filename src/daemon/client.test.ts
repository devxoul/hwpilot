import { describe, expect, test } from 'bun:test'
import { type AddressInfo, createServer, type Server } from 'node:net'
import { sendRequest } from '@/daemon/client'
import type { DaemonRequest, DaemonResponse } from '@/daemon/protocol'
import { createMessageReader, encodeMessage } from '@/daemon/protocol'

async function withMockServer(
  handler: (req: DaemonRequest) => DaemonResponse,
  fn: (port: number, token: string) => Promise<void>,
) {
  const server: Server = createServer((socket) => {
    const reader = createMessageReader((raw) => {
      const req = raw as DaemonRequest
      const response = handler(req)
      socket.write(encodeMessage(response))
      socket.end()
    })
    socket.on('data', reader)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const token = 'test-token-abc'

  try {
    await fn(port, token)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('sendRequest', () => {
  test('sends request and receives success response', async () => {
    await withMockServer(
      (req) => {
        expect(req.token).toBe('test-token-abc')
        expect(req.command).toBe('read')
        return { success: true, data: { sections: [] } }
      },
      async (port, token) => {
        const response = await sendRequest(port, token, {
          command: 'read',
          args: { file: 'test.hwpx' },
        })

        expect(response).toEqual({ success: true, data: { sections: [] } })
      },
    )
  })

  test('sends request and receives error response', async () => {
    await withMockServer(
      () => ({ success: false, error: 'File not found', hint: 'Check path' }),
      async (port, token) => {
        const response = await sendRequest(port, token, {
          command: 'read',
          args: { file: 'missing.hwpx' },
        })

        expect(response.success).toBe(false)
        if (!response.success) {
          expect(response.error).toBe('File not found')
          expect(response.hint).toBe('Check path')
        }
      },
    )
  })

  test('includes token in request automatically', async () => {
    let receivedToken = ''
    await withMockServer(
      (req) => {
        receivedToken = req.token
        return { success: true, data: null }
      },
      async (port, token) => {
        await sendRequest(port, token, { command: 'ping', args: {} })
        expect(receivedToken).toBe('test-token-abc')
      },
    )
  })

  test('throws on ECONNREFUSED for unused port', async () => {
    const unusedPort = 1
    await expect(sendRequest(unusedPort, 'token', { command: 'read', args: {} })).rejects.toThrow(/ECONNREFUSED/)
  })

  test('throws on response timeout', async () => {
    const server: Server = createServer((_socket) => {
      // intentional no-op: simulate unresponsive daemon
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port

    try {
      await expect(sendRequest(port, 'token', { command: 'read', args: {} })).rejects.toThrow(/timeout/i)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 40_000) // generous outer timeout for the 30s response timeout
})
