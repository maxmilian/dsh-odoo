import { describe, expect, it } from 'vitest'

import {
  createHttpError,
  createRpcError,
  MAX_DETAIL_CHARS,
  OdooApiError,
  sanitizeDetail,
} from '../src/errors.js'

const rpc = (name: string, message: string) => ({
  code: 200,
  message: 'Odoo Server Error',
  data: { name, message },
})

describe('OdooApiError', () => {
  it('exposes only safe fields through toJSON', () => {
    const error = new OdooApiError('boom', {
      code: 'ODOO_RPC_ERROR',
      status: 200,
      model: 'sale.order',
    })

    expect(error.name).toBe('OdooApiError')
    expect(error.toJSON()).toEqual({
      name: 'OdooApiError',
      code: 'ODOO_RPC_ERROR',
      status: 200,
      model: 'sale.order',
      odooException: undefined,
      retryAfter: undefined,
      detail: undefined,
    })
  })
})

describe('HTTP error mapping', () => {
  it.each([
    [401, 'AUTHENTICATION_FAILED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVER_ERROR'],
    [418, 'ODOO_HTTP_ERROR'],
    [400, 'ODOO_HTTP_ERROR'],
  ])('maps HTTP %i to %s', (status, code) => {
    expect(createHttpError(status).code).toBe(code)
  })

  it('attaches detail only for HTTP 400', () => {
    expect(createHttpError(400, { detail: 'bad domain' }).detail).toBe('bad domain')
    expect(createHttpError(403, { detail: 'bad domain' }).detail).toBeUndefined()
    expect(createHttpError(500, { detail: 'stack trace' }).detail).toBeUndefined()
  })

  it('keeps the Retry-After hint on 429', () => {
    expect(createHttpError(429, { retryAfter: '30' }).retryAfter).toBe('30')
  })
})

describe('JSON-RPC error mapping', () => {
  it.each([
    ['odoo.exceptions.AccessDenied', 'AUTHENTICATION_FAILED', false],
    ['odoo.exceptions.AccessError', 'PERMISSION_DENIED', false],
    ['odoo.exceptions.MissingError', 'NOT_FOUND', false],
    ['odoo.exceptions.UserError', 'ODOO_VALIDATION_ERROR', true],
    ['odoo.exceptions.ValidationError', 'ODOO_VALIDATION_ERROR', true],
    ['builtins.ValueError', 'ODOO_QUERY_ERROR', true],
    ['builtins.KeyError', 'ODOO_QUERY_ERROR', true],
    ['builtins.RuntimeError', 'ODOO_RPC_ERROR', false],
  ])('maps %s to %s (detail exposed: %s)', (name, code, exposed) => {
    const error = createRpcError(rpc(name, "Invalid field 'nope' on model 'sale.order'"))

    expect(error.code).toBe(code)
    expect(error.odooException).toBe(name)
    expect(error.detail === undefined).toBe(!exposed)
    if (exposed) expect(error.message).toContain('Odoo said:')
  })

  it('falls back to ODOO_RPC_ERROR when data.name is missing', () => {
    expect(createRpcError({ message: 'nope' }).code).toBe('ODOO_RPC_ERROR')
  })

  it('maps a missing configured database to INVALID_CONFIG without exposing detail', () => {
    const error = createRpcError(
      rpc('psycopg2.OperationalError', 'database "missing-db" does not exist'),
    )

    expect(error).toMatchObject({
      code: 'INVALID_CONFIG',
      message: 'The configured Odoo database was not found.',
      detail: undefined,
    })
  })
})

describe('sanitizeDetail', () => {
  it('returns undefined for non-strings and blank input', () => {
    expect(sanitizeDetail(undefined)).toBeUndefined()
    expect(sanitizeDetail(42)).toBeUndefined()
    expect(sanitizeDetail('   ')).toBeUndefined()
  })

  it('collapses whitespace and control characters', () => {
    expect(sanitizeDetail('a\n\tb   c')).toBe('a b c')
  })

  it('redacts the matched substring, not the whole message', () => {
    const detail = sanitizeDetail('Invalid field on model, token=abc123secret')

    expect(detail).toContain('Invalid field on model,')
    expect(detail).toContain('[redacted]')
    expect(detail).not.toContain('abc123secret')
  })

  it('redacts the configured api key verbatim', () => {
    expect(sanitizeDetail('key is 1a2b3c', '1a2b3c')).toBe('key is [redacted]')
  })

  it('redacts long opaque tokens', () => {
    expect(sanitizeDetail('value abcdefghijklmnopqrstuvwx here')).toBe('value [redacted] here')
  })

  it('truncates to the 200 character cap', () => {
    const detail = sanitizeDetail(Array.from({ length: 200 }, () => 'x y').join(' '))

    expect(detail).toHaveLength(MAX_DETAIL_CHARS)
    expect(detail?.endsWith('...')).toBe(true)
  })

  it('redacts before truncating so a secret cannot survive on the boundary', () => {
    const secret = 'S3CR3TS3CR3TS3CR3TS3CR3T'
    const filler = Array.from({ length: 95 }, () => 'ab').join(' ')
    const detail = sanitizeDetail(`${filler} ${secret}`, secret)

    expect(detail).not.toContain('S3CR3T')
  })
})
