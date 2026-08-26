/** Stable error codes produced by the Odoo client. */
export type OdooErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_INPUT'
  | 'AUTHENTICATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_ABORTED'
  | 'NETWORK_ERROR'
  | 'RESPONSE_TOO_LARGE'
  | 'INVALID_RESPONSE'
  | 'SERVER_ERROR'
  | 'ODOO_RPC_ERROR'
  | 'ODOO_VALIDATION_ERROR'
  | 'ODOO_QUERY_ERROR'
  | 'MODEL_NOT_ALLOWED'
  | 'WRITE_DISABLED'
  | 'TRANSPORT_UNSUPPORTED'
  | 'ODOO_HTTP_ERROR'

/** Safe structured details for an Odoo failure. */
export interface OdooApiErrorOptions {
  readonly code: OdooErrorCode
  readonly status?: number
  readonly model?: string
  readonly odooException?: string
  readonly retryAfter?: string
  readonly detail?: string
}

/** Structured API error that never embeds credentials or raw response bodies. */
export class OdooApiError extends Error {
  readonly code: OdooErrorCode
  readonly status?: number
  readonly model?: string
  readonly odooException?: string
  readonly retryAfter?: string
  readonly detail?: string

  /** Creates a safe Odoo API error. */
  constructor(message: string, options: OdooApiErrorOptions) {
    super(message)
    this.name = 'OdooApiError'
    this.code = options.code
    this.status = options.status
    this.model = options.model
    this.odooException = options.odooException
    this.retryAfter = options.retryAfter
    this.detail = options.detail
  }

  /** Returns JSON-safe error details suitable for diagnostics. */
  toJSON(): Record<string, number | string | undefined> {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      model: this.model,
      odooException: this.odooException,
      retryAfter: this.retryAfter,
      detail: this.detail,
    }
  }
}

/** Maximum characters exposed from an upstream error message. */
export const MAX_DETAIL_CHARS = 200

const REDACTED = '[redacted]'

/** Replaces C0 control characters with spaces without a control-character regex. */
function stripControlCharacters(value: string): string {
  let text = ''
  for (const character of value) {
    text += (character.codePointAt(0) ?? 0) < 0x20 ? ' ' : character
  }
  return text
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /(?:api[_-]?key|token|password|secret|authorization|bearer)\s*[:=]\s*\S+/gi,
  /[A-Za-z0-9_-]{20,}/g,
]

/** Odoo exception name to stable error code. */
const EXCEPTION_CODES: Readonly<Record<string, OdooErrorCode>> = {
  'odoo.exceptions.AccessDenied': 'AUTHENTICATION_FAILED',
  'odoo.exceptions.AccessError': 'PERMISSION_DENIED',
  'odoo.exceptions.MissingError': 'NOT_FOUND',
  'odoo.exceptions.UserError': 'ODOO_VALIDATION_ERROR',
  'odoo.exceptions.ValidationError': 'ODOO_VALIDATION_ERROR',
  'builtins.ValueError': 'ODOO_QUERY_ERROR',
  'builtins.KeyError': 'ODOO_QUERY_ERROR',
}

/** Codes whose upstream message may be exposed to the agent (G2). */
const DETAIL_CODES: ReadonlySet<OdooErrorCode> = new Set<OdooErrorCode>([
  'ODOO_VALIDATION_ERROR',
  'ODOO_QUERY_ERROR',
])

/** Static English message for every error code. Never localized. */
const CODE_MESSAGES: Readonly<Record<OdooErrorCode, string>> = {
  INVALID_CONFIG: 'The Odoo configuration is invalid.',
  INVALID_INPUT: 'The Odoo request input is invalid.',
  AUTHENTICATION_FAILED: 'Odoo rejected the credentials. Check db, username, and apiKey.',
  PERMISSION_DENIED: 'Odoo denied access to this resource.',
  NOT_FOUND: 'The requested Odoo record no longer exists.',
  RATE_LIMITED: 'Odoo rate limit exceeded. Retry later.',
  REQUEST_TIMEOUT: 'The Odoo request timed out.',
  REQUEST_ABORTED: 'The Odoo request was cancelled.',
  NETWORK_ERROR: 'Unable to reach the Odoo server.',
  RESPONSE_TOO_LARGE: 'The Odoo response exceeded the configured maximum size.',
  INVALID_RESPONSE: 'Odoo returned an unexpected response.',
  SERVER_ERROR: 'The Odoo server reported an internal error.',
  ODOO_RPC_ERROR: 'The Odoo server returned an RPC error.',
  ODOO_VALIDATION_ERROR: 'Odoo rejected the values.',
  ODOO_QUERY_ERROR: 'Odoo rejected the query.',
  MODEL_NOT_ALLOWED: 'This model is not on the allow list.',
  WRITE_DISABLED: 'Draft creation is disabled. Set allowWrite to true to enable it.',
  TRANSPORT_UNSUPPORTED: 'This Odoo server does not expose a usable /jsonrpc endpoint.',
  ODOO_HTTP_ERROR: 'The Odoo request failed.',
}

/** Truncates an already-sanitized string to the exposure cap. */
export function truncateDetail(value: string): string {
  return value.length <= MAX_DETAIL_CHARS ? value : `${value.slice(0, MAX_DETAIL_CHARS - 3)}...`
}

/** Redacts secrets from an upstream message, then truncates it. Order matters. */
export function sanitizeDetail(raw: unknown, apiKey = ''): string | undefined {
  if (typeof raw !== 'string') return undefined
  let text = stripControlCharacters(raw).replace(/\s+/g, ' ').trim()
  if (apiKey.length > 0) text = text.split(apiKey).join(REDACTED)
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, REDACTED)
  text = truncateDetail(text).trim()
  return text.length > 0 ? text : undefined
}

/** Creates a configuration error. */
export function configError(message: string): OdooApiError {
  return new OdooApiError(`Invalid Odoo configuration: ${message}`, { code: 'INVALID_CONFIG' })
}

/** Creates an input validation error. */
export function inputError(message: string): OdooApiError {
  return new OdooApiError(`Invalid Odoo input: ${message}`, { code: 'INVALID_INPUT' })
}

/** Maps an HTTP status to a stable error code. */
function httpErrorCode(status: number): OdooErrorCode {
  if (status === 401) return 'AUTHENTICATION_FAILED'
  if (status === 403) return 'PERMISSION_DENIED'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'SERVER_ERROR'
  return 'ODOO_HTTP_ERROR'
}

/** Creates a safe error for an unsuccessful HTTP response. */
export function createHttpError(
  status: number,
  options: { readonly retryAfter?: string; readonly detail?: string } = {},
): OdooApiError {
  const code = httpErrorCode(status)
  const detail = status === 400 ? options.detail : undefined
  const message =
    detail === undefined ? CODE_MESSAGES[code] : `${CODE_MESSAGES[code]} Odoo said: ${detail}`
  return new OdooApiError(message, {
    code,
    status,
    ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
    ...(detail === undefined ? {} : { detail }),
  })
}

/** Reads the Odoo exception name from a JSON-RPC error payload. */
function exceptionName(rpcError: unknown): string | undefined {
  if (typeof rpcError !== 'object' || rpcError === null) return undefined
  const data = (rpcError as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return undefined
  const name = (data as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

/** Reads the human-readable message from a JSON-RPC error payload. */
function exceptionMessage(rpcError: unknown): unknown {
  if (typeof rpcError !== 'object' || rpcError === null) return undefined
  const data = (rpcError as { data?: unknown }).data
  const nested =
    typeof data === 'object' && data !== null ? (data as { message?: unknown }).message : undefined
  return nested ?? (rpcError as { message?: unknown }).message
}

function isMissingDatabaseError(rpcError: unknown): boolean {
  const message = exceptionMessage(rpcError)
  return typeof message === 'string' && /\bdatabase\b.*\bdoes not exist\b/i.test(message)
}

/** Creates a safe error for a JSON-RPC level failure returned with HTTP 200. */
export function createRpcError(rpcError: unknown, apiKey = ''): OdooApiError {
  const name = exceptionName(rpcError)
  if (isMissingDatabaseError(rpcError)) {
    return new OdooApiError('The configured Odoo database was not found.', {
      code: 'INVALID_CONFIG',
      ...(name === undefined ? {} : { odooException: name }),
    })
  }
  const code = (name === undefined ? undefined : EXCEPTION_CODES[name]) ?? 'ODOO_RPC_ERROR'
  const detail = DETAIL_CODES.has(code)
    ? sanitizeDetail(exceptionMessage(rpcError), apiKey)
    : undefined
  const message =
    detail === undefined ? CODE_MESSAGES[code] : `${CODE_MESSAGES[code]} Odoo said: ${detail}`
  return new OdooApiError(message, {
    code,
    ...(name === undefined ? {} : { odooException: name }),
    ...(detail === undefined ? {} : { detail }),
  })
}
