import { describe, expect, it } from 'vitest'

import { assertCredentials, resolveConfig } from '../src/config.js'
import { OdooApiError } from '../src/errors.js'

const FULL_ENV = {
  ODOO_URL: 'https://env.example.com/odoo',
  ODOO_DB: 'envdb',
  ODOO_USERNAME: 'env-user',
  ODOO_API_KEY: 'env-key',
}

describe('resolveConfig', () => {
  it('prefers plugin config over environment variables', () => {
    const resolved = resolveConfig(
      { baseUrl: 'https://config.example.com/', db: 'cfgdb', username: 'cfg', apiKey: 'cfg-key' },
      FULL_ENV,
    )

    expect(resolved).toMatchObject({
      baseUrl: 'https://config.example.com/',
      db: 'cfgdb',
      username: 'cfg',
      apiKey: 'cfg-key',
      allowWrite: false,
      locale: 'en',
      defaultLimit: 20,
      requestTimeoutMs: 30_000,
      maxResponseBytes: 1_000_000,
    })
  })

  it('falls back to environment variables and normalizes the base URL', () => {
    expect(resolveConfig({}, FULL_ENV).baseUrl).toBe('https://env.example.com/odoo/')
  })

  it('normalizes repeated trailing slashes', () => {
    expect(resolveConfig({ baseUrl: 'https://odoo.example.com/erp///' }, {}).baseUrl).toBe(
      'https://odoo.example.com/erp/',
    )
  })

  it('ignores the environment for allowWrite', () => {
    expect(resolveConfig({}, { ...FULL_ENV, ODOO_ALLOW_WRITE: 'true' }).allowWrite).toBe(false)
  })

  it('parses companyId from the environment', () => {
    expect(resolveConfig({}, { ...FULL_ENV, ODOO_COMPANY_ID: '3' }).companyId).toBe(3)
  })

  it('does not throw when credentials are missing', () => {
    const resolved = resolveConfig({}, {})

    expect(resolved.baseUrl).toBe('')
    expect(resolved.db).toBe('')
    expect(resolved.username).toBe('')
    expect(resolved.apiKey).toBe('')
  })

  it.each([
    [{ baseUrl: 'ftp://odoo.example.com' }, {}],
    [{ baseUrl: 'https://user:pass@odoo.example.com' }, {}],
    [{ baseUrl: 'https://odoo.example.com?db=x' }, {}],
    [{ baseUrl: 'https://odoo.example.com#frag' }, {}],
    [{ requestTimeoutMs: 0 }, {}],
    [{ requestTimeoutMs: 300_001 }, {}],
    [{ maxResponseBytes: 52_428_801 }, {}],
    [{ defaultLimit: 0 }, {}],
    [{ defaultLimit: 101 }, {}],
    [{ companyId: 0 }, {}],
    [{ locale: 'de' as never }, {}],
    [{}, { ODOO_COMPANY_ID: 'abc' }],
    [{}, { ODOO_COMPANY_ID: '12junk' }],
    [{}, { ODOO_COMPANY_ID: '1.5' }],
    [{}, { ODOO_COMPANY_ID: '+3' }],
  ])('rejects invalid config %#', (config, env) => {
    expect(() => resolveConfig(config, env)).toThrowError(OdooApiError)
  })
})

describe('assertCredentials', () => {
  it('passes when every credential is present', () => {
    expect(() => assertCredentials(resolveConfig({}, FULL_ENV))).not.toThrow()
  })

  it.each(['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY'])(
    'throws when %s is missing',
    (missing) => {
      const config = resolveConfig({}, { ...FULL_ENV, [missing]: '' })

      expect(() => assertCredentials(config)).toThrowError(/Set baseUrl\/db\/username\/apiKey/)
    },
  )
})
