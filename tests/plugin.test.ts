import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import { apply, Config, inject, name } from '../src/index.js'

const pluginIt = Object.hasOwn(globalThis, 'Bun') ? it.skip : it

const CONFIG = {
  baseUrl: 'https://odoo.example.com',
  db: 'demo',
  username: 'admin',
  apiKey: 'secret',
}

const collectNames = (config: Record<string, unknown>) => {
  const names: string[] = []
  const register = vi.fn((definition: { name: string }) => {
    names.push(definition.name)
    return () => undefined
  })
  apply({ tools: { register } } as unknown as Context, config)
  return names
}

describe('DSH plugin entry', () => {
  it('exports the required identity and tools injection', () => {
    expect(name).toBe('dsh-odoo')
    expect(inject).toEqual(['tools'])
    expect(Config).toBeDefined()
  })

  it('exposes localized configuration descriptions', () => {
    expect(Config.meta.description).toMatchObject({
      en: expect.any(String),
      'zh-TW': expect.any(String),
      'zh-CN': expect.any(String),
      'ja-JP': expect.any(String),
    })
    expect(Config.dict?.apiKey?.meta.role).toBe('secret')
  })

  it('defaults locale to English and writing to disabled', () => {
    expect(Config.dict?.locale?.meta.default).toBe('en')
    expect(Config.dict?.allowWrite?.meta.default).toBe(false)
    expect(Config.dict?.defaultLimit?.meta).toMatchObject({ default: 20, min: 1, max: 100 })
  })

  pluginIt('registers three tools when writing is disabled', () => {
    expect(collectNames(CONFIG)).toEqual([
      'odoo_server_info',
      'odoo_describe_model',
      'odoo_search_read',
    ])
  })

  pluginIt('registers four tools when writing is enabled', () => {
    expect(collectNames({ ...CONFIG, allowWrite: true })).toHaveLength(4)
  })

  pluginIt('does not throw when credentials are missing', () => {
    expect(() => collectNames({})).not.toThrow()
  })

  pluginIt('throws on an out-of-range numeric setting', () => {
    expect(() => collectNames({ ...CONFIG, requestTimeoutMs: 0 })).toThrow()
  })
})
