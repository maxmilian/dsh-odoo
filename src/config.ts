import { configError } from './errors.js'

/** Default per-request timeout in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** Maximum accepted per-request timeout in milliseconds. */
export const MAX_REQUEST_TIMEOUT_MS = 300_000

/** Default maximum successful response body size in bytes. */
export const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000

/** Maximum accepted successful response body size in bytes. */
export const MAX_RESPONSE_BYTES = 52_428_800

/** Default number of records returned by a search. */
export const DEFAULT_LIMIT = 20

/** Maximum number of records returned by a single search. */
export const MAX_LIMIT = 100

/** Maximum accepted search offset. */
export const MAX_OFFSET = 10_000

/** Maximum reachable record window; offset plus limit may not exceed it. */
export const MAX_SEARCH_RESULTS = 10_000

/** Largest accepted company identifier. */
const MAX_COMPANY_ID = 2_147_483_647

/** Locales supported by the runtime tool metadata. */
export const LOCALES = ['en', 'zh-TW', 'zh-CN', 'ja'] as const

/** Locale supported by dsh-odoo tool metadata. */
export type Locale = (typeof LOCALES)[number]

/** Runtime configuration accepted by the client and plugin. */
export interface OdooConfig {
  /** Odoo base URL. Falls back to ODOO_URL. */
  readonly baseUrl?: string
  /** Odoo database name. Falls back to ODOO_DB. */
  readonly db?: string
  /** Odoo login. Falls back to ODOO_USERNAME. */
  readonly username?: string
  /** Odoo API key or password. Falls back to ODOO_API_KEY. */
  readonly apiKey?: string
  /** Company applied to every call. Falls back to ODOO_COMPANY_ID. */
  readonly companyId?: number
  /** Enables the restricted draft creation tool. */
  readonly allowWrite?: boolean
  /** Language used by tool metadata. */
  readonly locale?: Locale
  /** Records returned when a search does not specify a limit. */
  readonly defaultLimit?: number
  /** Per-request timeout in milliseconds. */
  readonly requestTimeoutMs?: number
  /** Maximum successful response body size in bytes. */
  readonly maxResponseBytes?: number
}

/** Fully validated runtime configuration. */
export interface ResolvedOdooConfig {
  readonly baseUrl: string
  readonly db: string
  readonly username: string
  readonly apiKey: string
  readonly companyId?: number
  readonly allowWrite: boolean
  readonly locale: Locale
  readonly defaultLimit: number
  readonly requestTimeoutMs: number
  readonly maxResponseBytes: number
}

/** Resolves plugin config over environment variables and validates safe bounds. */
export function resolveConfig(
  config: OdooConfig = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedOdooConfig {
  const baseUrl = config.baseUrl?.trim() || env.ODOO_URL?.trim() || ''
  const locale = config.locale ?? 'en'
  if (!LOCALES.includes(locale)) {
    throw configError(`locale must be one of ${LOCALES.join(', ')}.`)
  }
  const resolved: ResolvedOdooConfig = {
    baseUrl: baseUrl === '' ? '' : normalizeBaseUrl(baseUrl),
    db: assertLength('db', config.db?.trim() || env.ODOO_DB?.trim() || '', 100),
    username: assertLength(
      'username',
      config.username?.trim() || env.ODOO_USERNAME?.trim() || '',
      200,
    ),
    apiKey: assertLength('apiKey', config.apiKey?.trim() || env.ODOO_API_KEY?.trim() || '', 200),
    allowWrite: config.allowWrite === true,
    locale,
    defaultLimit: config.defaultLimit ?? DEFAULT_LIMIT,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxResponseBytes: config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    ...resolveCompanyId(config.companyId, env.ODOO_COMPANY_ID),
  }
  assertBoundedInteger('defaultLimit', resolved.defaultLimit, MAX_LIMIT)
  assertBoundedInteger('requestTimeoutMs', resolved.requestTimeoutMs, MAX_REQUEST_TIMEOUT_MS)
  assertBoundedInteger('maxResponseBytes', resolved.maxResponseBytes, MAX_RESPONSE_BYTES)
  return resolved
}

/** Fails when a credential needed for the JSON-RPC handshake is missing. */
export function assertCredentials(config: ResolvedOdooConfig): void {
  const missing = (['baseUrl', 'db', 'username', 'apiKey'] as const).filter(
    (key) => config[key].length === 0,
  )
  if (missing.length > 0) {
    throw configError(
      'Set baseUrl/db/username/apiKey, or the ODOO_URL/ODOO_DB/ODOO_USERNAME/ODOO_API_KEY environment variables.',
    )
  }
}

function resolveCompanyId(
  configured: number | undefined,
  fromEnv: string | undefined,
): { companyId?: number } {
  const raw = configured ?? (fromEnv?.trim() ? Number.parseInt(fromEnv.trim(), 10) : undefined)
  if (raw === undefined) return {}
  if (!Number.isSafeInteger(raw) || raw < 1 || raw > MAX_COMPANY_ID) {
    throw configError('companyId must be a positive integer.')
  }
  return { companyId: raw }
}

function assertLength(name: string, value: string, maximum: number): string {
  if (value.length > maximum) {
    throw configError(`${name} must contain at most ${maximum} characters.`)
  }
  return value
}

function normalizeBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw configError('baseUrl must be a valid HTTP or HTTPS URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw configError('baseUrl must be an HTTP(S) URL without embedded credentials.')
  }
  if (url.search || url.hash) {
    throw configError('baseUrl must not include a query string or fragment.')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url.toString()
}

function assertBoundedInteger(name: string, value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw configError(`${name} must be an integer between 1 and ${maximum}.`)
  }
}
