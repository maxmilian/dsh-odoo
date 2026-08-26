import { describe, expect, it, vi } from 'vitest'

import { OdooClient } from '../src/client.js'
import { resolveConfig } from '../src/config.js'

const CONFIG = resolveConfig({
  baseUrl: 'https://odoo.example.com',
  db: 'demo',
  username: 'admin',
  apiKey: 'secret-key',
  requestTimeoutMs: 1_000,
  maxResponseBytes: 100_000,
})

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

const ok = (result: unknown) => json({ jsonrpc: '2.0', id: 1, result })

/** Returns a fetch mock that answers each call from the supplied result queue. */
const queueFetch = (results: readonly unknown[]) => {
  let index = 0
  return vi.fn(() => {
    const result = results[index]
    index += 1
    return Promise.resolve(ok(result))
  })
}

const VERSION = { server_version: '18.0', server_serie: '18.0', protocol_version: 1 }

describe('handshake', () => {
  it('reports server version and uid', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7]))

    const result = await client.serverInfo()

    expect(result.data).toMatchObject({ serverVersion: '18.0', uid: 7, db: 'demo' })
    expect(result.meta.odooVersion).toBe('18.0')
  })

  it('never exposes the api key in the payload', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7]))

    const result = await client.serverInfo()

    expect(JSON.stringify(result)).not.toContain('secret-key')
  })

  it('authenticates only once across calls', async () => {
    const fetchMock = queueFetch([VERSION, 7])
    const client = new OdooClient(CONFIG, fetchMock)

    await client.serverInfo()
    await client.serverInfo()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries the handshake after a failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(ok(VERSION))
      .mockResolvedValueOnce(ok(7))
    const client = new OdooClient(CONFIG, fetchMock)

    await expect(client.serverInfo()).rejects.toMatchObject({ code: 'SERVER_ERROR' })
    await expect(client.serverInfo()).resolves.toMatchObject({ data: { uid: 7 } })
  })

  it('maps a false authenticate result to AUTHENTICATION_FAILED', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, false]))

    await expect(client.serverInfo()).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  })

  it('fails with INVALID_CONFIG when credentials are missing', async () => {
    const client = new OdooClient(resolveConfig({}, {}), vi.fn())

    await expect(client.serverInfo()).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })
})

describe('company validation', () => {
  const withCompany = resolveConfig({ ...CONFIG, companyId: 2 })

  it('accepts a company the user is allowed to use', async () => {
    const client = new OdooClient(
      withCompany,
      queueFetch([VERSION, 7, [{ id: 7, company_ids: [1, 2] }]]),
    )

    await expect(client.serverInfo()).resolves.toMatchObject({ data: { companyId: 2 } })
  })

  it('rejects a company outside the user allow list', async () => {
    const client = new OdooClient(
      withCompany,
      queueFetch([VERSION, 7, [{ id: 7, company_ids: [1] }]]),
    )

    await expect(client.serverInfo()).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })

  it('skips the company check when companyId is unset', async () => {
    const fetchMock = queueFetch([VERSION, 7])

    await new OdooClient(CONFIG, fetchMock).serverInfo()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
