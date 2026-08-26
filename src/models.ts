/** Models that may be queried by the read-only tools. */
export const READ_MODELS = [
  'res.partner',
  'res.users',
  'res.company',
  'product.product',
  'product.template',
  'sale.order',
  'sale.order.line',
  'purchase.order',
  'account.move',
  'account.move.line',
  'project.project',
  'project.task',
  'crm.lead',
  'stock.quant',
] as const

/** An Odoo model that the read-only tools accept. */
export type ReadModel = (typeof READ_MODELS)[number]

/** Models that the opt-in draft creation accepts. */
export const WRITE_MODELS = ['sale.order', 'project.task'] as const

/** An Odoo model that draft creation accepts. */
export type WriteModel = (typeof WRITE_MODELS)[number]

/** Field names that are known to hold binary payloads. Fast path only. */
export const BINARY_FIELDS: ReadonlySet<string> = new Set([
  'image_1920',
  'image_1024',
  'image_512',
  'image_256',
  'image_128',
  'avatar_1920',
  'avatar_128',
  'datas',
  'raw',
  'db_datas',
])

/** Fields returned when a search does not name any. Never includes active or binary fields. */
export const DEFAULT_FIELDS = {
  'res.partner': [
    'id',
    'name',
    'display_name',
    'email',
    'phone',
    'is_company',
    'parent_id',
    'city',
    'country_id',
    'vat',
  ],
  'res.users': ['id', 'name', 'login'],
  'res.company': ['id', 'name', 'currency_id'],
  'product.product': ['id', 'name', 'default_code', 'list_price', 'uom_id', 'type'],
  'product.template': ['id', 'name', 'default_code', 'list_price', 'categ_id', 'type'],
  'sale.order': [
    'id',
    'name',
    'partner_id',
    'date_order',
    'state',
    'amount_untaxed',
    'amount_total',
    'currency_id',
    'user_id',
    'client_order_ref',
  ],
  'sale.order.line': [
    'id',
    'order_id',
    'product_id',
    'name',
    'product_uom_qty',
    'price_unit',
    'price_subtotal',
  ],
  'purchase.order': [
    'id',
    'name',
    'partner_id',
    'date_order',
    'state',
    'amount_total',
    'currency_id',
  ],
  'account.move': [
    'id',
    'name',
    'partner_id',
    'move_type',
    'invoice_date',
    'invoice_date_due',
    'state',
    'payment_state',
    'amount_untaxed',
    'amount_total',
    'amount_residual',
    'currency_id',
  ],
  'account.move.line': ['id', 'move_id', 'name', 'account_id', 'debit', 'credit', 'balance'],
  'project.project': ['id', 'name', 'partner_id', 'user_id'],
  'project.task': [
    'id',
    'name',
    'project_id',
    'stage_id',
    'user_ids',
    'date_deadline',
    'priority',
    'partner_id',
    'write_date',
  ],
  'crm.lead': [
    'id',
    'name',
    'partner_id',
    'stage_id',
    'expected_revenue',
    'probability',
    'user_id',
    'date_deadline',
  ],
  'stock.quant': ['id', 'product_id', 'location_id', 'quantity', 'available_quantity', 'lot_id'],
} as const satisfies Record<ReadModel, readonly string[]>

/** Validation rule for one field accepted by draft creation. */
export interface FieldRule {
  readonly kind: 'int' | 'string' | 'date' | 'intArray'
  readonly required?: boolean
  readonly maxLength?: number
  readonly maxItems?: number
}

/** Fields that draft creation accepts, per write model. */
export const CREATE_FIELDS = {
  'sale.order': {
    partner_id: { kind: 'int', required: true },
    date_order: { kind: 'date' },
    client_order_ref: { kind: 'string', maxLength: 100 },
    note: { kind: 'string', maxLength: 2000 },
    user_id: { kind: 'int' },
  },
  'project.task': {
    name: { kind: 'string', required: true, maxLength: 200 },
    project_id: { kind: 'int', required: true },
    description: { kind: 'string', maxLength: 2000 },
    date_deadline: { kind: 'date' },
    partner_id: { kind: 'int' },
    user_ids: { kind: 'intArray', maxItems: 10 },
  },
} as const satisfies Record<WriteModel, Record<string, FieldRule>>

/** Fields a caller may never set, because drafts always use the default state. */
export const FORBIDDEN_CREATE_FIELDS = {
  'sale.order': ['state'],
  'project.task': ['state', 'stage_id'],
} as const satisfies Record<WriteModel, readonly string[]>

/** Fields read back after a draft is created. */
export const CREATE_READBACK_FIELDS = {
  'sale.order': ['id', 'name', 'state'],
  'project.task': ['id', 'name', 'stage_id'],
} as const satisfies Record<WriteModel, readonly string[]>

/** Maximum number of fields a caller may request. */
export const MAX_FIELDS = 30

/** Maximum number of elements in a domain. */
export const MAX_DOMAIN_LENGTH = 40

/** Maximum number of leaf conditions in a domain. */
export const MAX_DOMAIN_LEAVES = 20

/** Maximum length of a scalar domain value. */
export const MAX_VALUE_LENGTH = 200

/** Maximum number of values in an in-style domain comparison. */
export const MAX_IN_VALUES = 100

/** Maximum characters kept from a single string field value. */
export const MAX_STRING_CHARS = 2000

/** Maximum fields returned by the describe tool. */
export const MAX_DESCRIBE_FIELDS = 200

/** Maximum selection options returned per field. */
export const MAX_SELECTION_OPTIONS = 30

/** Maximum comma-separated terms accepted in an order clause. */
export const MAX_ORDER_TERMS = 3

/** Reports whether a value is an allow-listed read model. */
export function isReadModel(value: unknown): value is ReadModel {
  return typeof value === 'string' && (READ_MODELS as readonly string[]).includes(value)
}

/** Reports whether a value is an allow-listed write model. */
export function isWriteModel(value: unknown): value is WriteModel {
  return typeof value === 'string' && (WRITE_MODELS as readonly string[]).includes(value)
}
