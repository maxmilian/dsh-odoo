import type { JsonValue as DshJsonValue } from '@deepseek-ai/dsh-tools'

/** The canonical lossless JSON value accepted by DeepSeek Harness tool output. */
export type JsonValue = DshJsonValue

/** A JSON object with string keys. */
export type JsonObject = { [key: string]: JsonValue }

/**
 * Canonical response returned by every Odoo client method.
 *
 * `meta` carries only these keys, and only when the method produces them:
 * `model`, `total`, `returned`, `offset`, `truncatedFields`, `truncated`, `odooVersion`.
 */
export interface ApiResult<T extends JsonValue = JsonValue> {
  readonly data: T
  readonly meta: JsonObject
}

/** Parameters accepted by the restricted search_read. */
export interface SearchReadParams {
  readonly model: string
  readonly domain?: readonly JsonValue[]
  readonly fields?: readonly string[]
  readonly limit?: number
  readonly offset?: number
  readonly order?: string
}

/** Parameters accepted by the opt-in draft creation. */
export interface CreateDraftParams {
  readonly model: string
  readonly values: JsonObject
}
