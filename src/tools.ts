import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { OdooClient } from './client.js'
import type { Locale } from './config.js'
import type { OdooMessages } from './locales.js'
import { odooMessages } from './locales.js'
import { READ_MODELS, WRITE_MODELS } from './models.js'
import type { JsonObject, JsonValue } from './types.js'

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    data: { type: 'json', required: true },
    meta: { type: 'object', required: true, additionalProperties: true },
  },
} as const

const JSON_OUTPUT = {
  schema: OUTPUT_SCHEMA,
  render: (_args: unknown, value: JsonValue) => [
    { type: 'text' as const, text: JSON.stringify(value) },
  ],
} as const

/** Builds every tool exposed by dsh-odoo. */
export function createOdooTools(
  client: OdooClient,
  locale: Locale,
  allowWrite: boolean,
): ToolDefinition[] {
  const messages = odooMessages(locale)
  const tools = [
    serverInfoTool(client, messages),
    describeModelTool(client, messages),
    searchReadTool(client, messages),
  ]
  if (allowWrite) tools.push(createDraftTool(client, messages))
  return tools
}

function serverInfoTool(client: OdooClient, messages: OdooMessages): ToolDefinition {
  return defineTool({
    name: 'odoo_server_info',
    description: messages.serverInfoDescription,
    parameters: {},
    output: JSON_OUTPUT,
    execute: (_args, exec) => client.serverInfo(exec.signal),
    isConcurrencySafe: () => true,
  })
}

function describeModelTool(client: OdooClient, messages: OdooMessages): ToolDefinition {
  return defineTool({
    name: 'odoo_describe_model',
    description: messages.describeModelDescription,
    parameters: {
      model: {
        type: 'string',
        required: true,
        enum: READ_MODELS,
        description: messages.describeModelParam,
      },
    },
    output: JSON_OUTPUT,
    execute: (args, exec) => client.describeModel(args.model, exec.signal),
    isConcurrencySafe: () => true,
  })
}

function searchReadTool(client: OdooClient, messages: OdooMessages): ToolDefinition {
  return defineTool({
    name: 'odoo_search_read',
    description: messages.searchReadDescription,
    parameters: {
      model: {
        type: 'string',
        required: true,
        enum: READ_MODELS,
        description: messages.modelParam,
      },
      domain: {
        type: 'array',
        items: { type: 'json' },
        description: messages.domainParam,
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: messages.fieldsParam,
      },
      limit: { type: 'integer', description: messages.limitParam },
      offset: { type: 'integer', description: messages.offsetParam },
      order: { type: 'string', description: messages.orderParam },
    },
    output: JSON_OUTPUT,
    execute: (args, exec) =>
      client.searchRead(
        {
          model: args.model,
          ...(args.domain === undefined ? {} : { domain: args.domain }),
          ...(args.fields === undefined ? {} : { fields: args.fields }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.offset === undefined ? {} : { offset: args.offset }),
          ...(args.order === undefined ? {} : { order: args.order }),
        },
        exec.signal,
      ),
    isConcurrencySafe: () => true,
  })
}

function createDraftTool(client: OdooClient, messages: OdooMessages): ToolDefinition {
  return defineTool({
    name: 'odoo_create_draft',
    description: messages.createDraftDescription,
    parameters: {
      model: {
        type: 'string',
        required: true,
        enum: WRITE_MODELS,
        description: messages.writeModelParam,
      },
      values: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: messages.valuesParam,
      },
    },
    output: JSON_OUTPUT,
    execute: (args, exec) =>
      client.createDraft({ model: args.model, values: args.values as JsonObject }, exec.signal),
    isConcurrencySafe: () => true,
    presentCall: () => ({ card: 'generic', title: messages.createDraftTitle, kind: 'edit' }),
  })
}
