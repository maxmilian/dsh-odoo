import type { JsonValue as DshJsonValue } from '@deepseek-ai/dsh-tools'

/** The canonical lossless JSON value accepted by DeepSeek Harness tool output. */
export type JsonValue = DshJsonValue

/** A JSON object with string keys. */
export type JsonObject = { [key: string]: JsonValue }

/** Safe response metadata exposed by every Odoo client method. */
export interface ApiMeta {
  readonly model?: string
  readonly total?: number
  readonly returned?: number
  readonly offset?: number
  readonly truncatedFields?: readonly string[]
  readonly truncated?: boolean
  readonly odooVersion?: string
}

/** Canonical response returned by every Odoo client method. */
export interface ApiResult<T extends JsonValue = JsonValue> {
  readonly data: T
  readonly meta: ApiMeta
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
