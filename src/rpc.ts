import { createHttpError, createRpcError, OdooApiError, sanitizeDetail } from './errors.js'
import type { JsonValue } from './types.js'

/** Minimal fetch surface used by the transport, so tests can inject a stub. */
export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

/** One JSON-RPC call against an Odoo service. */
export interface RpcParams {
  readonly service: 'common' | 'object'
  readonly method: string
  readonly args: readonly JsonValue[]
}

/** Construction options for the transport. */
export interface RpcTransportOptions {
  readonly baseUrl: string
  readonly apiKey: string
  readonly requestTimeoutMs: number
  readonly maxResponseBytes: number
  readonly fetchImplementation?: FetchImplementation
}

interface RequestContext {
  readonly controller: AbortController
  readonly dispose: () => void
  readonly didTimeout: () => boolean
}

const TRANSPORT_MESSAGES = {
  missing:
    'This Odoo server does not expose /jsonrpc. Check the reverse proxy, or that the "web" module is installed.',
  redirected: 'The /jsonrpc endpoint redirected; check baseUrl (http vs https, trailing path).',
  notJsonRpc: 'The /jsonrpc endpoint returned a response that is not JSON-RPC 2.0.',
} as const

/** JSON-RPC 2.0 transport for the Odoo external API. */
export class RpcTransport {
  readonly #baseUrl: string
  readonly #apiKey: string
  readonly #requestTimeoutMs: number
  readonly #maxResponseBytes: number
  readonly #fetch: FetchImplementation
  #id = 0

  /** Creates a transport bound to one Odoo base URL. */
  constructor(options: RpcTransportOptions) {
    this.#baseUrl = options.baseUrl
    this.#apiKey = options.apiKey
    this.#requestTimeoutMs = options.requestTimeoutMs
    this.#maxResponseBytes = options.maxResponseBytes
    this.#fetch = options.fetchImplementation ?? fetch
  }

  /** Performs one JSON-RPC call and returns its result value. */
  async call(
    params: RpcParams,
    signal?: AbortSignal,
    maxResponseBytesOverride?: number,
  ): Promise<JsonValue> {
    const url = new URL('jsonrpc', this.#baseUrl)
    const context = createRequestContext(signal, this.#requestTimeoutMs)
    this.#id += 1
    try {
      const response = await this.#fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: this.#id, params }),
        signal: context.controller.signal,
      })
      await this.#assertUsableResponse(response)
      return await this.#readResult(response, maxResponseBytesOverride ?? this.#maxResponseBytes)
    } catch (error: unknown) {
      throw normalizeRequestError(error, signal, context, this.#requestTimeoutMs)
    } finally {
      context.dispose()
    }
  }

  /** Rejects responses that prove /jsonrpc is unusable or the request failed. */
  async #assertUsableResponse(response: Response): Promise<void> {
    const probe = probeFailure(response.status)
    if (probe !== undefined) {
      await response.body?.cancel()
      throw transportError(probe, response.status)
    }
    if (!response.ok) throw await this.#httpFailure(response)
    if (!isJsonContentType(response.headers.get('content-type')?.toLowerCase() ?? '')) {
      await response.body?.cancel()
      throw transportError(TRANSPORT_MESSAGES.missing, response.status)
    }
  }

  /** Builds the error for a non-2xx response, exposing detail only for HTTP 400. */
  async #httpFailure(response: Response): Promise<OdooApiError> {
    const { status } = response
    const retryAfter = safeHeader(response.headers, 'Retry-After', this.#apiKey)
    const detail = status === 400 ? await this.#readErrorDetail(response) : undefined
    if (status !== 400) await response.body?.cancel()
    return createHttpError(status, {
      ...(retryAfter === undefined ? {} : { retryAfter }),
      ...(detail === undefined ? {} : { detail }),
    })
  }

  /** Reads and unwraps a JSON-RPC envelope. */
  async #readResult(response: Response, maximum: number): Promise<JsonValue> {
    const body = parseJson(await readBoundedBody(response, maximum))
    if (!isJsonObject(body)) throw transportError(TRANSPORT_MESSAGES.notJsonRpc)
    if (body.error !== undefined) throw createRpcError(body.error, this.#apiKey)
    if (!Object.hasOwn(body, 'result')) throw transportError(TRANSPORT_MESSAGES.notJsonRpc)
    return body.result as JsonValue
  }

  /** Extracts a sanitized upstream message from a failed response body. */
  async #readErrorDetail(response: Response): Promise<string | undefined> {
    try {
      const body: unknown = JSON.parse(await readBoundedBody(response, this.#maxResponseBytes))
      if (!isJsonObject(body) || !isJsonObject(body.error)) return undefined
      const nested = isJsonObject(body.error.data) ? body.error.data.message : undefined
      return sanitizeDetail(nested ?? body.error.message, this.#apiKey)
    } catch {
      return undefined
    }
  }
}

/** Returns the transport failure message for a status that proves /jsonrpc is unusable. */
function probeFailure(status: number): string | undefined {
  if (status >= 300 && status < 400) return TRANSPORT_MESSAGES.redirected
  if (status === 404 || status === 405) return TRANSPORT_MESSAGES.missing
  return undefined
}

function transportError(message: string, status?: number): OdooApiError {
  return new OdooApiError(message, {
    code: 'TRANSPORT_UNSUPPORTED',
    ...(status === undefined ? {} : { status }),
  })
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonContentType(value: string): boolean {
  const mediaType = value.split(';', 1)[0]?.trim()
  return (
    mediaType === 'application/json' ||
    (mediaType?.startsWith('application/') === true && mediaType.endsWith('+json'))
  )
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new OdooApiError('Odoo returned invalid JSON.', { code: 'INVALID_RESPONSE' })
  }
}

function createRequestContext(signal: AbortSignal | undefined, timeoutMs: number): RequestContext {
  const controller = new AbortController()
  let timedOut = false
  const abortFromCaller = (): void => controller.abort(signal?.reason)
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  return {
    controller,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abortFromCaller)
    },
  }
}

function normalizeRequestError(
  error: unknown,
  callerSignal: AbortSignal | undefined,
  context: RequestContext,
  timeoutMs: number,
): OdooApiError {
  if (error instanceof OdooApiError) return error
  if (context.didTimeout()) {
    return new OdooApiError(`The Odoo request timed out after ${timeoutMs} ms.`, {
      code: 'REQUEST_TIMEOUT',
    })
  }
  if (callerSignal?.aborted) {
    return new OdooApiError('The Odoo request was cancelled.', { code: 'REQUEST_ABORTED' })
  }
  return new OdooApiError('Unable to reach the Odoo server.', { code: 'NETWORK_ERROR' })
}

function safeHeader(headers: Headers, name: string, apiKey: string): string | undefined {
  const value = headers.get(name)?.trim()
  if (!value || value.length > 128 || (apiKey.length > 0 && value.includes(apiKey))) {
    return undefined
  }
  return value
}

async function readBoundedBody(response: Response, maximum: number): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength && Number(contentLength) > maximum) {
    await response.body?.cancel()
    throw responseTooLarge(maximum)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return text + decoder.decode()
    total += value.byteLength
    if (total > maximum) {
      await reader.cancel()
      throw responseTooLarge(maximum)
    }
    text += decoder.decode(value, { stream: true })
  }
}

function responseTooLarge(maximum: number): OdooApiError {
  return new OdooApiError(
    `The Odoo response exceeded the configured maximum of ${maximum} bytes.`,
    {
      code: 'RESPONSE_TOO_LARGE',
    },
  )
}
