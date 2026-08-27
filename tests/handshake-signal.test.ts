import { describe, expect, it, vi } from 'vitest'

import { OdooClient } from '../src/client.js'
import { resolveConfig } from '../src/config.js'

const CONFIG = resolveConfig({
  baseUrl: 'https://odoo.example.com',
  db: 'demo',
  username: 'admin',
  apiKey: 'secret-key',
})

const json = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
    headers: { 'Content-Type': 'application/json' },
  })

const VERSION = { server_version: '18.0', server_serie: '18.0', protocol_version: 1 }

/** Answers the handshake only after the caller yields, and honours the abort signal. */
const slowHandshake = () => {
  let step = 0
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    const result = step === 0 ? VERSION : 7
    step += 1
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(json(result)), 5)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('aborted', 'AbortError'))
      })
    })
  })
}

describe('shared handshake cancellation', () => {
  it('does not cancel a second caller when the first one aborts', async () => {
    const client = new OdooClient(CONFIG, slowHandshake())
    const controller = new AbortController()

    const first = client.serverInfo(controller.signal)
    const second = client.serverInfo()
    controller.abort()

    await expect(second).resolves.toMatchObject({ data: { uid: 7 } })
    await expect(first).resolves.toMatchObject({ data: { uid: 7 } })
  })
})
