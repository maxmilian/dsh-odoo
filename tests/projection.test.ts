import { describe, expect, it } from 'vitest'

import { OdooClient } from '../src/client.js'
import { resolveConfig } from '../src/config.js'
import { callHandler, fakeOdoo, handshakeHandler } from './fake-odoo.js'

const CONFIG = resolveConfig({
  baseUrl: 'https://odoo.example.com',
  db: 'demo',
  username: 'admin',
  apiKey: 'secret-key',
})

const WRITABLE = resolveConfig({ ...CONFIG, allowWrite: true })

const FIELDS_GET = {
  id: { string: 'ID', type: 'integer' },
  name: { string: 'Name', type: 'char' },
  partner_id: { string: 'Customer', type: 'many2one', relation: 'res.partner' },
  image_1920: { string: 'Image', type: 'binary' },
}

/** An upstream that ignores the requested `fields` and adds binary and secret keys. */
const chattySearchRead = () =>
  fakeOdoo([
    handshakeHandler(),
    callHandler('fields_get', () => FIELDS_GET),
    callHandler('search_count', () => 1),
    callHandler('search_read', () => [
      { id: 1, name: 'ACME', image_1920: 'QUJDREVGRw==', secret_field: 'leaked' },
    ]),
  ])

describe('searchRead response projection', () => {
  it('drops keys the caller did not request', async () => {
    const client = new OdooClient(CONFIG, chattySearchRead())

    const result = await client.searchRead({ model: 'sale.order', fields: ['id'] })

    expect(result.data).toEqual([{ id: 1 }])
  })

  it('never leaks a binary field the upstream added on its own', async () => {
    const client = new OdooClient(CONFIG, chattySearchRead())

    const result = await client.searchRead({ model: 'sale.order', fields: ['id', 'name'] })

    expect(JSON.stringify(result.data)).not.toContain('QUJDREVGRw==')
    expect(result.data).toEqual([{ id: 1, name: 'ACME' }])
  })

  it('always keeps the id Odoo returns even when it was not requested', async () => {
    const client = new OdooClient(CONFIG, chattySearchRead())

    const result = await client.searchRead({ model: 'sale.order', fields: ['name'] })

    expect(result.data).toEqual([{ id: 1, name: 'ACME' }])
  })
})

describe('createDraft response projection', () => {
  it('keeps only the fixed readback fields', async () => {
    const client = new OdooClient(
      WRITABLE,
      fakeOdoo([
        handshakeHandler(),
        callHandler('create', () => 42),
        callHandler('read', () => [
          { id: 42, name: 'S0001', state: 'draft', api_secret: 'leaked', image_1920: 'QUJD' },
        ]),
      ]),
    )

    const result = await client.createDraft({ model: 'sale.order', values: { partner_id: 3 } })

    expect(result.data).toEqual({ id: 42, name: 'S0001', state: 'draft' })
  })
})

const LONG = 'x'.repeat(2_500)

const nestedSearchRead = (row: Record<string, unknown>) =>
  fakeOdoo([
    handshakeHandler(),
    callHandler('fields_get', () => FIELDS_GET),
    callHandler('search_count', () => 1),
    callHandler('search_read', () => [row]),
  ])

describe('nested value sanitizing', () => {
  it('truncates the display name inside a many2one pair', async () => {
    const client = new OdooClient(CONFIG, nestedSearchRead({ id: 1, partner_id: [4, LONG] }))

    const result = await client.searchRead({ model: 'sale.order', fields: ['id', 'partner_id'] })
    const pair = (result.data as { partner_id: [number, string] }[])[0]?.partner_id

    expect(pair?.[0]).toBe(4)
    expect(pair?.[1].endsWith('[truncated]')).toBe(true)
    expect(pair?.[1].length).toBeLessThan(LONG.length)
    expect(result.meta.truncatedFields).toEqual(['partner_id'])
  })

  it('truncates strings nested inside an object value', async () => {
    const client = new OdooClient(
      CONFIG,
      nestedSearchRead({ id: 1, name: { deep: { deeper: LONG } } }),
    )

    const result = await client.searchRead({ model: 'sale.order', fields: ['id', 'name'] })
    const nested = (result.data as { name: { deep: { deeper: string } } }[])[0]?.name

    expect(nested?.deep.deeper.endsWith('[truncated]')).toBe(true)
    expect(result.meta.truncatedFields).toEqual(['name'])
  })

  it('caps the nesting depth an upstream can force', async () => {
    let deep: unknown = LONG
    for (let level = 0; level < 40; level += 1) deep = [deep]
    const client = new OdooClient(CONFIG, nestedSearchRead({ id: 1, name: deep }))

    const result = await client.searchRead({ model: 'sale.order', fields: ['id', 'name'] })

    expect(JSON.stringify(result.data)).not.toContain(LONG)
    expect(result.meta.truncatedFields).toEqual(['name'])
  })
})
