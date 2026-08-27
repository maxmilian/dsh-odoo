import { describe, expect, it } from 'vitest'

import { OdooClient } from '../src/client.js'
import { resolveConfig } from '../src/config.js'
import { callHandler, fakeOdoo, handshakeHandler } from './fake-odoo.js'

const SMALL_CAP = resolveConfig({
  baseUrl: 'https://odoo.example.com',
  db: 'demo',
  username: 'admin',
  apiKey: 'secret-key',
  maxResponseBytes: 50_000,
})

/** A fields_get payload well over the configured cap but under the relaxed 8 MB one. */
const HUGE_FIELDS_GET = Object.fromEntries(
  Array.from({ length: 400 }, (_, index) => [
    `f${index}`,
    { string: 'F'.repeat(500), type: index === 0 ? 'integer' : 'char' },
  ]),
)

describe('fields_get byte cap', () => {
  it('relaxes the cap for the metadata call every tool depends on', async () => {
    const client = new OdooClient(
      SMALL_CAP,
      fakeOdoo([handshakeHandler(), callHandler('fields_get', () => HUGE_FIELDS_GET)]),
    )

    const result = await client.describeModel('sale.order')

    expect(result.meta.model).toBe('sale.order')
    expect(result.meta.returned).toBe(200)
  })

  it('still applies the configured cap to a search_read response', async () => {
    const client = new OdooClient(
      SMALL_CAP,
      fakeOdoo([
        handshakeHandler(),
        callHandler('fields_get', () => ({ id: { type: 'integer' } })),
        callHandler('search_count', () => 1),
        callHandler('search_read', () => [{ id: 1, blob: 'y'.repeat(60_000) }]),
      ]),
    )

    await expect(client.searchRead({ model: 'sale.order', fields: ['id'] })).rejects.toMatchObject({
      code: 'RESPONSE_TOO_LARGE',
    })
  })
})
