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

type FetchCall = [URL, RequestInit]

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

const FIELDS_GET = {
  id: { string: 'ID', type: 'integer' },
  name: { string: 'Name', type: 'char' },
  partner_id: { string: 'Customer', type: 'many2one', relation: 'res.partner' },
  image_1920: { string: 'Image', type: 'binary' },
  signature: { string: 'Signature', type: 'binary' },
  state: {
    string: 'Status',
    type: 'selection',
    selection: [
      ['draft', 'Quotation'],
      ['sale', 'Sales Order'],
    ],
  },
}

describe('describeModel', () => {
  it('returns trimmed field metadata', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET]))

    const result = await client.describeModel('sale.order')

    expect(result.meta.model).toBe('sale.order')
    expect(Object.keys(result.data as object)).toEqual(['id', 'name', 'partner_id', 'state'])
    expect(result.data).toMatchObject({ name: { string: 'Name', type: 'char' } })
  })

  it('drops binary fields entirely', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET]))

    const result = await client.describeModel('sale.order')

    expect(result.data).not.toHaveProperty('image_1920')
    expect(result.data).not.toHaveProperty('signature')
  })

  it('rejects a model outside the allow list', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7]))

    await expect(client.describeModel('ir.attachment')).rejects.toMatchObject({
      code: 'MODEL_NOT_ALLOWED',
    })
  })

  it('calls fields_get only once per model', async () => {
    const fetchMock = queueFetch([VERSION, 7, FIELDS_GET])
    const client = new OdooClient(CONFIG, fetchMock)

    await client.describeModel('sale.order')
    await client.describeModel('sale.order')

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('truncates a long selection list', async () => {
    const selection = Array.from({ length: 40 }, (_, index) => [`s${index}`, `S${index}`])
    const client = new OdooClient(
      CONFIG,
      queueFetch([VERSION, 7, { state: { string: 'Status', type: 'selection', selection } }]),
    )

    const result = await client.describeModel('sale.order')

    expect(result.meta.truncatedFields).toEqual(['state'])
  })

  it('caps the field count at two hundred', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => [`f${index}`, { string: 'F', type: 'char' }]),
    )
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, many]))

    const result = await client.describeModel('sale.order')

    expect(result.meta.truncated).toBe(true)
    expect(result.meta.returned).toBe(200)
  })
})

describe('searchRead', () => {
  const records = [{ id: 1, name: 'ACME', partner_id: [4, 'ACME Inc'] }]

  it('sends the model default fields when none are given', async () => {
    const fetchMock = queueFetch([VERSION, 7, FIELDS_GET, 1, records])
    const client = new OdooClient(CONFIG, fetchMock)

    await client.searchRead({ model: 'sale.order' })

    const body = JSON.parse(String((fetchMock.mock.calls[4] as unknown as FetchCall)[1].body))
    expect(body.params.args[4]).toBe('search_read')
    expect(body.params.args[6].fields).toContain('id')
  })

  it('returns total, returned, and offset in meta', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET, 137, records]))

    const result = await client.searchRead({ model: 'sale.order', fields: ['id', 'name'] })

    expect(result.meta).toMatchObject({ model: 'sale.order', total: 137, returned: 1, offset: 0 })
  })

  it('truncates long string values and reports the field', async () => {
    const long = [{ id: 1, name: 'x'.repeat(2_500) }]
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET, 1, long]))

    const result = await client.searchRead({ model: 'sale.order', fields: ['id', 'name'] })
    const record = (result.data as { name: string }[])[0]

    expect(record?.name.endsWith('[truncated]')).toBe(true)
    expect(result.meta.truncatedFields).toEqual(['name'])
  })

  it('keeps many2one values in the native pair shape', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET, 1, records]))

    const result = await client.searchRead({ model: 'sale.order', fields: ['id', 'partner_id'] })

    expect((result.data as { partner_id: unknown }[])[0]?.partner_id).toEqual([4, 'ACME Inc'])
  })

  it('rejects a model outside the allow list', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7]))

    await expect(client.searchRead({ model: 'ir.attachment' })).rejects.toMatchObject({
      code: 'MODEL_NOT_ALLOWED',
    })
  })

  it('rejects an unknown field with the available field list', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET]))

    await expect(
      client.searchRead({ model: 'sale.order', fields: ['nope'] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects a binary field that is not on the fast-path list', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET]))

    await expect(
      client.searchRead({ model: 'sale.order', fields: ['signature'] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects a dotted domain field', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET]))

    await expect(
      client.searchRead({ model: 'sale.order', domain: [['partner_id.name', '=', 'x']] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('passes allowed_company_ids in the context when configured', async () => {
    const fetchMock = queueFetch([
      VERSION,
      7,
      [{ id: 7, company_ids: [1, 2] }],
      FIELDS_GET,
      1,
      records,
    ])
    const client = new OdooClient(resolveConfig({ ...CONFIG, companyId: 2 }), fetchMock)

    await client.searchRead({ model: 'sale.order', fields: ['id'] })

    const last = fetchMock.mock.calls.at(-1) as unknown as FetchCall
    const body = JSON.parse(String(last[1].body))
    expect(body.params.args[6].context).toEqual({ allowed_company_ids: [2] })
  })
})
