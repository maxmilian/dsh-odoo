import { MAX_LIMIT, MAX_OFFSET, MAX_SEARCH_RESULTS } from './config.js'
import { inputError, truncateDetail } from './errors.js'
import type { FieldRule, ReadModel, WriteModel } from './models.js'
import {
  BINARY_FIELDS,
  CREATE_FIELDS,
  DEFAULT_FIELDS,
  FORBIDDEN_CREATE_FIELDS,
  MAX_DOMAIN_LEAVES,
  MAX_DOMAIN_LENGTH,
  MAX_FIELDS,
  MAX_IN_VALUES,
  MAX_ORDER_TERMS,
  MAX_VALUE_LENGTH,
} from './models.js'
import type { JsonObject, JsonValue } from './types.js'

const FIELD_PATTERN = /^[a-z_][a-z0-9_]*$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DIRECTIONS: ReadonlySet<string> = new Set(['asc', 'desc'])

const OPERATORS: ReadonlySet<string> = new Set([
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'like',
  'not like',
  'ilike',
  'not ilike',
  'in',
  'not in',
  'child_of',
  'parent_of',
  '=like',
  '=ilike',
])

interface ParseState {
  readonly domain: readonly unknown[]
  readonly knownFields: ReadonlySet<string>
  readonly binaryFields: ReadonlySet<string>
  leaves: number
}

/** Rejects a field name that contains a dot or is unknown to the model. */
function assertFieldName(
  field: unknown,
  knownFields: ReadonlySet<string>,
  where: string,
  binaryFields: ReadonlySet<string> = new Set(),
): string {
  if (typeof field !== 'string') {
    throw inputError(`${where} must name a field.`)
  }
  if (field.includes('.')) {
    throw inputError(
      `${where} must not contain a dot; query the related model first and filter with ('field_id','in',[ids]).`,
    )
  }
  if (!FIELD_PATTERN.test(field)) {
    throw inputError(`${where} is not a valid Odoo field name.`)
  }
  if (!knownFields.has(field)) {
    throw inputError(`${where} names a field that does not exist on this model: ${field}.`)
  }
  if (binaryFields.has(field)) {
    throw inputError(`${where} names a binary field and cannot be used.`)
  }
  return field
}

/** Rejects a value that is not a scalar Odoo domain operand. */
function assertScalar(value: unknown, where: string): void {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return
  if (typeof value === 'string') {
    if (value.length > MAX_VALUE_LENGTH) {
      throw inputError(`${where} must contain at most ${MAX_VALUE_LENGTH} characters.`)
    }
    return
  }
  throw inputError(`${where} must be a string, number, boolean, or null.`)
}

/** Validates one domain leaf and counts it. */
function assertLeaf(state: ParseState, node: unknown, index: number): void {
  if (!Array.isArray(node) || node.length !== 3) {
    throw inputError(`domain element at index ${index} must be a triple.`)
  }
  assertFieldName(node[0], state.knownFields, `domain field at index ${index}`, state.binaryFields)
  if (typeof node[1] !== 'string' || !OPERATORS.has(node[1])) {
    throw inputError(`domain operator at index ${index} is not supported.`)
  }
  const value: unknown = node[2]
  if (Array.isArray(value)) {
    if (value.length > MAX_IN_VALUES) {
      throw inputError(
        `domain value at index ${index} must contain at most ${MAX_IN_VALUES} items.`,
      )
    }
    for (const item of value) assertScalar(item, `domain value at index ${index}`)
  } else {
    assertScalar(value, `domain value at index ${index}`)
  }
  state.leaves += 1
}

/** Consumes one prefix node and returns the next unconsumed index. */
function parseNode(state: ParseState, index: number): number {
  if (index >= state.domain.length) {
    throw inputError(`domain is missing an operand at index ${index}.`)
  }
  const node = state.domain[index]
  if (node === '!') return parseNode(state, index + 1)
  if (node === '&' || node === '|') return parseNode(state, parseNode(state, index + 1))
  assertLeaf(state, node, index)
  return index + 1
}

/** Validates an Odoo domain: structure, arity, field names, operators, and values. */
export function validateDomain(
  domain: unknown,
  knownFields: ReadonlySet<string>,
  binaryFields: ReadonlySet<string> = new Set(),
): JsonValue[] {
  if (!Array.isArray(domain)) throw inputError('domain must be an array.')
  if (domain.length > MAX_DOMAIN_LENGTH) {
    throw inputError(`domain must contain at most ${MAX_DOMAIN_LENGTH} elements.`)
  }
  const state: ParseState = { domain, knownFields, binaryFields, leaves: 0 }
  let index = 0
  while (index < domain.length) index = parseNode(state, index)
  if (state.leaves > MAX_DOMAIN_LEAVES) {
    throw inputError(`domain must contain at most ${MAX_DOMAIN_LEAVES} leaves.`)
  }
  return domain as JsonValue[]
}

/** Rejects one requested field that is malformed, binary, or unknown to the model. */
function assertRequestableField(
  field: unknown,
  model: ReadModel,
  fieldTypes: ReadonlyMap<string, string>,
): void {
  if (typeof field !== 'string' || field.includes('.') || !FIELD_PATTERN.test(field)) {
    throw inputError('each field must be a plain Odoo field name without a dot.')
  }
  if (BINARY_FIELDS.has(field) || fieldTypes.get(field) === 'binary') {
    throw inputError(`field ${field} is a binary field and cannot be requested.`)
  }
  if (!fieldTypes.has(field)) {
    const available = truncateDetail([...fieldTypes.keys()].join(', '))
    throw inputError(`field ${field} does not exist on ${model}. Available fields: ${available}`)
  }
}

/** Validates requested fields, falling back to the model default field set. */
export function validateFields(
  fields: readonly string[] | undefined,
  model: ReadModel,
  fieldTypes: ReadonlyMap<string, string>,
): readonly string[] {
  const resolved = fields ?? DEFAULT_FIELDS[model]
  if (resolved.length < 1 || resolved.length > MAX_FIELDS) {
    throw inputError(`fields must contain 1-${MAX_FIELDS} names.`)
  }
  for (const field of resolved) assertRequestableField(field, model, fieldTypes)
  return resolved
}

/** Validates an order clause of at most three terms. */
export function validateOrder(
  order: string | undefined,
  knownFields: ReadonlySet<string>,
  binaryFields: ReadonlySet<string> = new Set(),
): string | undefined {
  if (order === undefined) return undefined
  const terms = order.split(',').map((term) => term.trim())
  if (terms.length > MAX_ORDER_TERMS) {
    throw inputError(`order must contain at most ${MAX_ORDER_TERMS} terms.`)
  }
  const normalized = terms.map((term, index) => {
    const parts = term.split(/\s+/).filter((part) => part.length > 0)
    const field = assertFieldName(
      parts[0],
      knownFields,
      `order field at index ${index}`,
      binaryFields,
    )
    if (parts.length === 1) return field
    if (parts.length > 2 || !DIRECTIONS.has((parts[1] ?? '').toLowerCase())) {
      throw inputError(`order direction at index ${index} must be asc or desc.`)
    }
    return `${field} ${(parts[1] ?? '').toLowerCase()}`
  })
  return normalized.join(', ')
}

/** Validates the search window and applies the configured default limit. */
export function validatePagination(
  limit: number | undefined,
  offset: number | undefined,
  defaultLimit: number,
): { limit: number; offset: number } {
  const resolvedLimit = limit ?? defaultLimit
  const resolvedOffset = offset ?? 0
  if (!Number.isSafeInteger(resolvedLimit) || resolvedLimit < 1 || resolvedLimit > MAX_LIMIT) {
    throw inputError(`limit must be an integer between 1 and ${MAX_LIMIT}.`)
  }
  if (!Number.isSafeInteger(resolvedOffset) || resolvedOffset < 0 || resolvedOffset > MAX_OFFSET) {
    throw inputError(`offset must be an integer between 0 and ${MAX_OFFSET}.`)
  }
  if (resolvedOffset + resolvedLimit > MAX_SEARCH_RESULTS) {
    throw inputError(`offset plus limit must stay within the first ${MAX_SEARCH_RESULTS} records.`)
  }
  return { limit: resolvedLimit, offset: resolvedOffset }
}

/** Validates a positive integer id value. */
function ruleInt(key: string, value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw inputError(`values.${key} must be a positive integer id.`)
  }
  return value as number
}

/** Validates a bounded non-empty string value. */
function ruleString(key: string, rule: FieldRule, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw inputError(`values.${key} must be a non-empty string.`)
  }
  if (value.length > (rule.maxLength ?? MAX_VALUE_LENGTH)) {
    throw inputError(`values.${key} must contain at most ${rule.maxLength} characters.`)
  }
  return value
}

/** Validates a YYYY-MM-DD date value. */
function ruleDate(key: string, value: unknown): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw inputError(`values.${key} must be a date formatted as YYYY-MM-DD.`)
  }
  return value
}

/** Validates one create value against its rule and returns the Odoo payload value. */
function ruleValue(key: string, rule: FieldRule, value: unknown): JsonValue {
  if (rule.kind === 'int') return ruleInt(key, value)
  if (rule.kind === 'string') return ruleString(key, rule, value)
  if (rule.kind === 'date') return ruleDate(key, value)
  return [[6, 0, assertIdArray(key, rule, value)]]
}

function assertIdArray(key: string, rule: FieldRule, value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw inputError(`values.${key} must be a non-empty array of ids.`)
  }
  if (value.length > (rule.maxItems ?? MAX_IN_VALUES)) {
    throw inputError(`values.${key} must contain at most ${rule.maxItems} ids.`)
  }
  for (const item of value) {
    if (!Number.isSafeInteger(item) || (item as number) < 1) {
      throw inputError(`values.${key} must contain positive integer ids.`)
    }
  }
  return value as number[]
}

/** Rejects any field that the fixed draft policy forbids. */
function assertNoForbiddenFields(model: WriteModel, source: Record<string, unknown>): void {
  for (const forbidden of FORBIDDEN_CREATE_FIELDS[model]) {
    if (Object.hasOwn(source, forbidden)) {
      throw inputError(`values must not include ${forbidden}; drafts always use the default state.`)
    }
  }
}

function createRule(
  rules: Readonly<Record<string, FieldRule>>,
  key: string,
  model: WriteModel,
): FieldRule {
  if (!Object.hasOwn(rules, key) || rules[key] === undefined) {
    throw inputError(`values field ${key} is not allowed for ${model}.`)
  }
  return rules[key]
}

/** Validates draft creation values and applies the fixed draft policy. */
export function validateCreateValues(model: WriteModel, values: unknown): JsonObject {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    throw inputError('values must be an object.')
  }
  const rules: Record<string, FieldRule> = CREATE_FIELDS[model]
  const source = values as Record<string, unknown>
  assertNoForbiddenFields(model, source)
  const payload: JsonObject = {}
  for (const [key, value] of Object.entries(source)) {
    const rule = createRule(rules, key, model)
    payload[key] = ruleValue(key, rule, value)
  }
  for (const [key, rule] of Object.entries(rules)) {
    if (rule.required === true && payload[key] === undefined) {
      throw inputError(`values must include ${key}.`)
    }
  }
  if (model === 'sale.order') payload.state = 'draft'
  return payload
}
