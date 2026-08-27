import { vi } from 'vitest'

/** One decoded JSON-RPC call reaching the fake Odoo server. */
export interface FakeOdooRequest {
  readonly service: string
  readonly method: string
  readonly model: string
  readonly call: string
  readonly args: readonly unknown[]
  readonly kwargs: Record<string, unknown>
}

/** Answers one decoded call; returning undefined falls through to the next handler. */
export type FakeOdooHandler = (request: FakeOdooRequest) => unknown

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

const decode = (init: RequestInit | undefined): FakeOdooRequest => {
  const body = JSON.parse(String(init?.body)) as {
    params: { service: string; method: string; args: unknown[] }
  }
  const { service, method, args } = body.params
  if (service !== 'object' || method !== 'execute_kw') {
    return { service, method, model: '', call: '', args, kwargs: {} }
  }
  return {
    service,
    method,
    model: String(args[3]),
    call: String(args[4]),
    args: (args[5] ?? []) as unknown[],
    kwargs: (args[6] ?? {}) as Record<string, unknown>,
  }
}

/**
 * Returns a fetch mock that answers each call from the request itself, so a test
 * can model an upstream that ignores `fields` or returns unexpected extra keys.
 */
export const fakeOdoo = (handlers: readonly FakeOdooHandler[]) =>
  vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    const request = decode(init)
    for (const handler of handlers) {
      const result = handler(request)
      if (result !== undefined)
        return Promise.resolve(jsonResponse({ jsonrpc: '2.0', id: 1, result }))
    }
    throw new Error(
      `fake Odoo has no handler for ${request.model}.${request.call || request.method}`,
    )
  })

/** Standard handshake handler pair: common.version and common.authenticate. */
export const handshakeHandler =
  (uid = 7): FakeOdooHandler =>
  (request) => {
    if (request.method === 'version') {
      return { server_version: '18.0', server_serie: '18.0', protocol_version: 1 }
    }
    if (request.method === 'authenticate') return uid
    return undefined
  }

/** Answers one execute_kw call for a given model method. */
export const callHandler =
  (call: string, respond: (request: FakeOdooRequest) => unknown): FakeOdooHandler =>
  (request) =>
    request.call === call ? respond(request) : undefined
