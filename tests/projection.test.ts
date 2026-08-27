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
