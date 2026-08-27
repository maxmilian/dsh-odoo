import { describe, expect, it, vi } from 'vitest'

import { OdooApiError } from '../src/errors.js'
import type { FetchImplementation } from '../src/rpc.js'
import { RpcTransport } from '../src/rpc.js'

type FetchCall = [URL, RequestInit]

const OPTIONS = {
  baseUrl: 'https://odoo.example.com/',
  apiKey: 'secret-key',
  requestTimeoutMs: 1_000,
  maxResponseBytes: 10_000,
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

const transportWith = (fetchImplementation: () => Promise<Response>) =>
  new RpcTransport({ ...OPTIONS, fetchImplementation })

const VERSION = { service: 'common', method: 'version', args: [] } as const

describe('successful calls', () => {
  it('posts JSON-RPC 2.0 to the jsonrpc endpoint and returns result', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(json({ jsonrpc: '2.0', id: 1, result: { a: 1 } })),
    )
    const transport = new RpcTransport({ ...OPTIONS, fetchImplementation: fetchMock })

    await expect(transport.call(VERSION)).resolves.toEqual({ a: 1 })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://odoo.example.com/jsonrpc')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(JSON.parse(String(init.body))).toMatchObject({
      jsonrpc: '2.0',
      method: 'call',
      params: { service: 'common', method: 'version', args: [] },
    })
  })

  it('increments the request id on every call', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json({ jsonrpc: '2.0', id: 1, result: true })))
    const transport = new RpcTransport({ ...OPTIONS, fetchImplementation: fetchMock })

    await transport.call(VERSION)
    await transport.call(VERSION)

    const ids = (fetchMock.mock.calls as unknown as FetchCall[]).map(
      ([, init]) => JSON.parse(String(init.body)).id as number,
    )
    expect(ids[1]).toBe((ids[0] ?? 0) + 1)
  })
})

describe('JSON-RPC level errors', () => {
  it('throws even though the HTTP status is 200', async () => {
    const transport = transportWith(() =>
      Promise.resolve(
        json({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: 200,
            message: 'Odoo Server Error',
            data: { name: 'builtins.ValueError', message: "Invalid field 'x'" },
          },
        }),
      ),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({
      code: 'ODOO_QUERY_ERROR',
      detail: expect.stringContaining('Invalid field'),
    })
  })
})

describe('transport probing', () => {
  it.each([
    ['404', () => Promise.resolve(new Response('nope', { status: 404 }))],
    ['405', () => Promise.resolve(new Response('nope', { status: 405 }))],
    [
      '302',
      () => Promise.resolve(new Response('', { status: 302, headers: { Location: '/web/login' } })),
    ],
    [
      'html',
      () =>
        Promise.resolve(
          new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }),
        ),
    ],
    ['not json-rpc', () => Promise.resolve(json({ hello: 'world' }))],
  ])('maps a %s response to TRANSPORT_UNSUPPORTED', async (_label, fetchImplementation) => {
    await expect(transportWith(fetchImplementation).call(VERSION)).rejects.toMatchObject({
      code: 'TRANSPORT_UNSUPPORTED',
    })
  })
})

describe('HTTP level errors', () => {
  it.each([
    [401, 'AUTHENTICATION_FAILED'],
    [403, 'PERMISSION_DENIED'],
    [500, 'SERVER_ERROR'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const transport = transportWith(() => Promise.resolve(new Response('x', { status })))

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code })
  })

  it('keeps the Retry-After header on 429', async () => {
    const transport = transportWith(() =>
      Promise.resolve(new Response('x', { status: 429, headers: { 'Retry-After': '42' } })),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfter: '42',
    })
  })

  it('never leaks the api key through a response header', async () => {
    const transport = transportWith(() =>
      Promise.resolve(new Response('x', { status: 429, headers: { 'Retry-After': 'secret-key' } })),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({ retryAfter: undefined })
  })

  it('exposes a sanitized detail for HTTP 400', async () => {
    const transport = transportWith(() =>
      Promise.resolve(
        json(
          { error: { data: { message: "Invalid field 'nope' on model 'sale.order'" } } },
          { status: 400 },
        ),
      ),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({
      code: 'ODOO_HTTP_ERROR',
      detail: expect.stringContaining('Invalid field'),
    })
  })
})

describe('response size limits', () => {
  it('rejects when content-length exceeds the cap', async () => {
    const transport = transportWith(() =>
      Promise.resolve(
        new Response('{}', {
          headers: { 'Content-Type': 'application/json', 'Content-Length': '20000' },
        }),
      ),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('rejects when the streamed body exceeds the cap', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'y'.repeat(20_000) })
    const transport = transportWith(() =>
      Promise.resolve(new Response(big, { headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('reports an oversized HTTP 400 body as RESPONSE_TOO_LARGE', async () => {
    const big = JSON.stringify({ error: { message: 'z'.repeat(20_000) } })
    const transport = transportWith(() =>
      Promise.resolve(
        new Response(big, {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('honours a per-call override of the byte cap', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'y'.repeat(20_000) })
    const transport = transportWith(() =>
      Promise.resolve(new Response(big, { headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(transport.call(VERSION, undefined, 100_000)).resolves.toBeTypeOf('string')
  })
})

describe('invalid responses', () => {
  it('rejects malformed JSON', async () => {
    const transport = transportWith(() =>
      Promise.resolve(new Response('{oops', { headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})

describe('cancellation', () => {
  it('maps a caller abort to REQUEST_ABORTED', async () => {
    const controller = new AbortController()
    const transport = transportWith(
      () =>
        new Promise<Response>((_resolve, reject) => {
          controller.abort()
          reject(new DOMException('aborted', 'AbortError'))
        }),
    )

    await expect(transport.call(VERSION, controller.signal)).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
    })
  })

  it('maps a timeout to REQUEST_TIMEOUT', async () => {
    const transport = new RpcTransport({
      ...OPTIONS,
      requestTimeoutMs: 1,
      fetchImplementation: ((_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        })) as FetchImplementation,
    })

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
  })

  it('maps a network failure to NETWORK_ERROR', async () => {
    const transport = transportWith(() => Promise.reject(new TypeError('fetch failed')))

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})

describe('error type', () => {
  it('always throws OdooApiError', async () => {
    const transport = transportWith(() => Promise.resolve(new Response('x', { status: 500 })))

    await expect(transport.call(VERSION)).rejects.toBeInstanceOf(OdooApiError)
  })
})
