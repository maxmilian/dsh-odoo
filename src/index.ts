/**
 * dsh-odoo — read-only Odoo tools for DeepSeek Harness.
 * @module dsh-odoo
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

import { createOdooClient } from './client.js'
import type { OdooConfig } from './config.js'
import {
  DEFAULT_LIMIT,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  LOCALES,
  MAX_LIMIT,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
} from './config.js'
import { CONFIG_I18N } from './locales.js'
import { createOdooTools } from './tools.js'

/** Stable Cordis plugin name. */
export const name = 'dsh-odoo'

/** DSH services required by this plugin. */
export const inject = ['tools']

/** Plugin configuration supplied through Cordis. */
export type Config = OdooConfig

/** Schemastery configuration exposed by the plugin. */
export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default(''),
  db: Schema.string().default(''),
  username: Schema.string().default(''),
  apiKey: Schema.string().role('secret').default(''),
  companyId: Schema.number().step(1).min(1),
  allowWrite: Schema.boolean().default(false),
  locale: Schema.union(LOCALES).default('en'),
  defaultLimit: Schema.number().step(1).min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  requestTimeoutMs: Schema.number()
    .step(1)
    .min(1)
    .max(MAX_REQUEST_TIMEOUT_MS)
    .default(DEFAULT_REQUEST_TIMEOUT_MS),
  maxResponseBytes: Schema.number()
    .step(1)
    .min(1)
    .max(MAX_RESPONSE_BYTES)
    .default(DEFAULT_MAX_RESPONSE_BYTES),
}).i18n(CONFIG_I18N)

/** Creates one client and registers every enabled tool. */
export function apply(ctx: Context, config: Config): void {
  const client = createOdooClient(config)
  for (const tool of createOdooTools(client, config.locale ?? 'en', config.allowWrite === true)) {
    ctx.tools.register(tool)
  }
}

export { createOdooClient, OdooClient } from './client.js'
export type { OdooConfig, ResolvedOdooConfig } from './config.js'
export { LOCALES, type Locale, resolveConfig } from './config.js'
export { createHttpError, OdooApiError } from './errors.js'
export { READ_MODELS, WRITE_MODELS } from './models.js'
export type * from './types.js'
