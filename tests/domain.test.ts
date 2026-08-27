import { describe, expect, it } from 'vitest'

import {
  validateCreateValues,
  validateDomain,
  validateFields,
  validateOrder,
  validatePagination,
} from '../src/domain.js'
import { OdooApiError } from '../src/errors.js'
import { DEFAULT_FIELDS } from '../src/models.js'

const FIELDS = new Set(['id', 'name', 'partner_id', 'state', 'amount_total'])
const TYPES = new Map<string, string>([
  ['id', 'integer'],
  ['name', 'char'],
  ['partner_id', 'many2one'],
  ['state', 'selection'],
  ['image_1920', 'binary'],
  ['signature', 'binary'],
])
const SALE_ORDER_TYPES = new Map<string, string>([
  ...DEFAULT_FIELDS['sale.order'].map((field) => [field, 'char'] as const),
  ...TYPES,
])

const WITH_ACTIVE = new Set([...FIELDS, 'active'])

describe('the archived-record guarantee', () => {
  it.each([[['active', '=', false]], [['active', 'in', [true, false]]], [['active', '!=', true]]])(
    'rejects a domain leaf that reopens archived records: %j',
    (leaf) => {
      expect(() => validateDomain([leaf], WITH_ACTIVE)).toThrow(OdooApiError)
    },
  )

  it('rejects active nested under a logical operator', () => {
    expect(() =>
      validateDomain(['|', ['name', '=', 'x'], ['active', '=', false]], WITH_ACTIVE),
    ).toThrow(OdooApiError)
  })

  it('still allows active as a requested field', () => {
    const types = new Map([...SALE_ORDER_TYPES, ['active', 'boolean']])
    expect(validateFields(['id', 'active'], 'sale.order', types)).toEqual(['id', 'active'])
  })
})

describe('validateDomain', () => {
  it('accepts an empty domain', () => {
    expect(validateDomain([], FIELDS)).toEqual([])
  })

  it('accepts multiple top-level leaves as an implicit AND', () => {
    const domain = [
      ['state', '=', 'draft'],
      ['partner_id', 'in', [1, 2]],
    ]

    expect(validateDomain(domain, FIELDS)).toEqual(domain)
  })

  it('accepts nested prefix operators', () => {
    const domain = ['&', ['state', '=', 'draft'], '|', ['name', 'ilike', 'a'], ['id', '>', 5]]

    expect(validateDomain(domain, FIELDS)).toEqual(domain)
  })

  it('accepts the unary not operator', () => {
    const domain = ['!', ['state', '=', 'draft']]

    expect(validateDomain(domain, FIELDS)).toEqual(domain)
  })

  it('rejects a dotted field name', () => {
    expect(() => validateDomain([['partner_id.name', 'ilike', 'a']], FIELDS)).toThrowError(/dot/i)
  })

  it('rejects a binary-operator arity shortfall', () => {
    expect(() => validateDomain(['&', ['state', '=', 'draft']], FIELDS)).toThrowError(/operand/i)
  })

  it('rejects a trailing unary operator', () => {
    expect(() => validateDomain([['id', '=', 1], '!'], FIELDS)).toThrowError(/operand/i)
  })

  it('rejects an unknown field', () => {
    expect(() => validateDomain([['nope', '=', 1]], FIELDS)).toThrowError(/nope/)
  })

  it('rejects an unknown operator', () => {
    expect(() => validateDomain([['id', '~=', 1]], FIELDS)).toThrowError(OdooApiError)
  })

  it('rejects a nested object as a value', () => {
    expect(() => validateDomain([['id', '=', { a: 1 }]], FIELDS)).toThrowError(OdooApiError)
  })

  it('rejects a leaf that is not a triple', () => {
    expect(() => validateDomain([['id', '=']], FIELDS)).toThrowError(OdooApiError)
  })

  it('rejects more than twenty leaves', () => {
    const domain = Array.from({ length: 21 }, () => ['id', '=', 1])

    expect(() => validateDomain(domain, FIELDS)).toThrowError(/leaves|20/)
  })

  it('never echoes the offending value', () => {
    let error: unknown
    try {
      validateDomain([['name', 'ilike', 'super-secret-customer']], new Set(['id']))
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(OdooApiError)
    expect((error as Error).message).not.toContain('super-secret-customer')
  })
})

describe('validateFields', () => {
  it('falls back to the model default field set', () => {
    expect(validateFields(undefined, 'sale.order', SALE_ORDER_TYPES)).toContain('id')
  })

  it('rejects a field the model does not define', () => {
    expect(() => validateFields(['nope'], 'sale.order', TYPES)).toThrowError(/nope/)
  })

  it('lists available fields in the error message and caps it', () => {
    try {
      validateFields(['nope'], 'sale.order', TYPES)
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as Error).message.length).toBeLessThanOrEqual(260)
      expect((error as Error).message).toContain('partner_id')
    }
  })

  it('rejects a binary field even when it is not in the fast-path list', () => {
    expect(() => validateFields(['signature'], 'sale.order', TYPES)).toThrowError(/binary/i)
  })

  it('rejects a binary field from the fast-path list', () => {
    expect(() => validateFields(['image_1920'], 'sale.order', TYPES)).toThrowError(/binary/i)
  })

  it('rejects more than thirty fields', () => {
    const fields = Array.from({ length: 31 }, (_, index) => `f${index}`)

    expect(() => validateFields(fields, 'sale.order', TYPES)).toThrowError(/30/)
  })
})

describe('validateOrder', () => {
  it('accepts up to three terms', () => {
    expect(validateOrder('name asc, id desc', FIELDS)).toBe('name asc, id desc')
  })

  it('rejects a dotted order field', () => {
    expect(() => validateOrder('partner_id.name asc', FIELDS)).toThrowError(/dot/i)
  })

  it('rejects an unknown direction', () => {
    expect(() => validateOrder('name sideways', FIELDS)).toThrowError(OdooApiError)
  })

  it('rejects more than three terms', () => {
    expect(() => validateOrder('id, name, state, amount_total', FIELDS)).toThrowError(/3/)
  })
})

describe('validatePagination', () => {
  it('applies the configured default limit', () => {
    expect(validatePagination(undefined, undefined, 20)).toEqual({ limit: 20, offset: 0 })
  })

  it.each([
    [101, 0],
    [0, 0],
    [10, -1],
    [10, 10_001],
    [100, 10_000],
  ])('rejects limit %i with offset %i', (limit, offset) => {
    expect(() => validatePagination(limit, offset, 20)).toThrowError(OdooApiError)
  })

  it('accepts a window that ends exactly on the search cap', () => {
    expect(validatePagination(100, 9_900, 20)).toEqual({ limit: 100, offset: 9_900 })
  })
})

describe('validateCreateValues', () => {
  it('forces the draft state on a sale order', () => {
    const values = validateCreateValues('sale.order', { partner_id: 7 })

    expect(values).toEqual({ partner_id: 7, state: 'draft' })
  })

  it('rejects an explicit state on a sale order', () => {
    expect(() => validateCreateValues('sale.order', { partner_id: 7, state: 'sale' })).toThrowError(
      /state/,
    )
  })

  it.each(['state', 'stage_id'])('rejects %s on a project task', (field) => {
    expect(() =>
      validateCreateValues('project.task', { name: 'a', project_id: 1, [field]: 3 }),
    ).toThrowError(new RegExp(field))
  })

  it('does not add a state to a project task', () => {
    const values = validateCreateValues('project.task', { name: 'a', project_id: 1 })

    expect(values).toEqual({ name: 'a', project_id: 1 })
  })

  it('converts user_ids into a replace command', () => {
    const values = validateCreateValues('project.task', {
      name: 'a',
      project_id: 1,
      user_ids: [2, 3],
    })

    expect(values.user_ids).toEqual([[6, 0, [2, 3]]])
  })

  it('rejects a field outside the allow list', () => {
    expect(() =>
      validateCreateValues('sale.order', { partner_id: 7, order_line: [[0, 0, {}]] }),
    ).toThrowError(/order_line/)
  })

  it.each([
    '__proto__',
    'constructor',
    'toString',
    'valueOf',
    'hasOwnProperty',
    '__defineGetter__',
  ])('rejects inherited Object.prototype key %s', (key) => {
    const values = JSON.parse(`{"partner_id":7,"${key}":[1]}`) as Record<string, unknown>

    expect(() => validateCreateValues('sale.order', values)).toThrowError(/not allowed/)
  })

  it('rejects a missing required field', () => {
    expect(() => validateCreateValues('sale.order', {})).toThrowError(/partner_id/)
  })

  it('rejects an over-long string', () => {
    expect(() =>
      validateCreateValues('sale.order', { partner_id: 7, client_order_ref: 'x'.repeat(101) }),
    ).toThrowError(/client_order_ref/)
  })

  it('rejects a malformed date', () => {
    expect(() =>
      validateCreateValues('sale.order', { partner_id: 7, date_order: '2026/08/26' }),
    ).toThrowError(/date_order/)
  })
})
