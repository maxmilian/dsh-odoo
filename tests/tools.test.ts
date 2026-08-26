import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'

import type { OdooClient } from '../src/client.js'
import { READ_MODELS, WRITE_MODELS } from '../src/models.js'
import { createOdooTools } from '../src/tools.js'

const stubClient = () =>
  ({
    serverInfo: vi.fn().mockResolvedValue({ data: { uid: 1 }, meta: { odooVersion: '18.0' } }),
    describeModel: vi.fn().mockResolvedValue({ data: {}, meta: { model: 'sale.order' } }),
    searchRead: vi.fn().mockResolvedValue({ data: [], meta: { model: 'sale.order', total: 0 } }),
    createDraft: vi.fn().mockResolvedValue({ data: { id: 1 }, meta: { model: 'sale.order' } }),
  }) as unknown as OdooClient

const byName = (tools: readonly ToolDefinition[], name: string) =>
  tools.find((tool) => tool.name === name)

const parameterOf = (tool: ToolDefinition | undefined, key: string) =>
  (tool?.parameters as Record<string, unknown> | undefined)?.[key]

describe('tool registration', () => {
  it('exposes three read-only tools when writing is disabled', () => {
    const tools = createOdooTools(stubClient(), 'en', false)

    expect(tools.map((tool) => tool.name)).toEqual([
      'odoo_server_info',
      'odoo_describe_model',
      'odoo_search_read',
    ])
  })

  it('adds the draft tool when writing is enabled', () => {
    const tools = createOdooTools(stubClient(), 'en', true)

    expect(tools).toHaveLength(4)
    expect(byName(tools, 'odoo_create_draft')).toBeDefined()
  })

  it('marks every tool concurrency safe', () => {
    for (const tool of createOdooTools(stubClient(), 'en', true)) {
      expect(tool.isConcurrencySafe?.({} as never)).toBe(true)
    }
  })

  it('presents only the draft tool, as an edit', () => {
    const tools = createOdooTools(stubClient(), 'en', true)

    expect(byName(tools, 'odoo_server_info')?.presentCall).toBeUndefined()
    expect(byName(tools, 'odoo_search_read')?.presentCall).toBeUndefined()
    expect(byName(tools, 'odoo_create_draft')?.presentCall?.({} as never)).toMatchObject({
      kind: 'edit',
    })
  })
})

describe('tool parameters', () => {
  it('restricts the search model to the read allow list', () => {
    const tool = byName(createOdooTools(stubClient(), 'en', false), 'odoo_search_read')

    expect(parameterOf(tool, 'model')).toMatchObject({ required: true, enum: [...READ_MODELS] })
  })

  it('restricts the draft model to the write allow list', () => {
    const tool = byName(createOdooTools(stubClient(), 'en', true), 'odoo_create_draft')

    expect(parameterOf(tool, 'model')).toMatchObject({ required: true, enum: [...WRITE_MODELS] })
  })

  it('keeps tool names in English across locales', () => {
    const english = createOdooTools(stubClient(), 'en', true).map((tool) => tool.name)
    const japanese = createOdooTools(stubClient(), 'ja', true).map((tool) => tool.name)

    expect(japanese).toEqual(english)
  })

  it('localizes descriptions', () => {
    const english = byName(createOdooTools(stubClient(), 'en', false), 'odoo_search_read')
    const chinese = byName(createOdooTools(stubClient(), 'zh-TW', false), 'odoo_search_read')

    expect(chinese?.description).not.toBe(english?.description)
  })
})

describe('tool execution', () => {
  it('forwards search parameters to the client', async () => {
    const client = stubClient()
    const tool = byName(createOdooTools(client, 'en', false), 'odoo_search_read')

    await tool?.execute?.(
      { model: 'sale.order', domain: [], fields: ['id'], limit: 5, offset: 0, order: 'id desc' },
      { signal: undefined } as never,
    )

    expect(client.searchRead).toHaveBeenCalledWith(
      { model: 'sale.order', domain: [], fields: ['id'], limit: 5, offset: 0, order: 'id desc' },
      undefined,
    )
  })

  it('emits only meta keys from the output contract', async () => {
    const tool = byName(createOdooTools(stubClient(), 'en', false), 'odoo_search_read')
    const result = (await tool?.execute?.({ model: 'sale.order' }, { signal: undefined } as never)) as {
      meta: Record<string, unknown>
    }
    const allowed = [
      'model',
      'total',
      'returned',
      'offset',
      'truncatedFields',
      'truncated',
      'odooVersion',
    ]

    expect(Object.keys(result.meta).every((key) => allowed.includes(key))).toBe(true)
  })

  it('renders the result as a single JSON text block', () => {
    const tool = byName(createOdooTools(stubClient(), 'en', false), 'odoo_server_info')
    const rendered = tool?.output?.render?.({}, { data: { uid: 1 }, meta: {} } as never)

    expect(rendered).toEqual([{ type: 'text', text: '{"data":{"uid":1},"meta":{}}' }])
  })
})
