import { describe, expect, it } from 'vitest'

import { LOCALES } from '../src/config.js'
import { CONFIG_I18N, MESSAGES, odooMessages } from '../src/locales.js'

describe('tool metadata locales', () => {
  it('covers every supported locale', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...LOCALES].sort())
  })

  it('never leaves a message blank', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(MESSAGES[locale]) as [string, string][]) {
        expect(value, `${locale}.${key}`).toBeTypeOf('string')
        expect(value.length, `${locale}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('defines the same message keys in every locale', () => {
    const reference = Object.keys(MESSAGES.en).sort()
    for (const locale of LOCALES) {
      expect(Object.keys(MESSAGES[locale]).sort()).toEqual(reference)
    }
  })

  it('translates every description away from English', () => {
    for (const locale of LOCALES.filter((value) => value !== 'en')) {
      expect(MESSAGES[locale].searchReadDescription).not.toBe(MESSAGES.en.searchReadDescription)
      expect(MESSAGES[locale].createDraftDescription).not.toBe(MESSAGES.en.createDraftDescription)
    }
  })

  it('states the draft policy for both write models in every locale', () => {
    for (const locale of LOCALES) {
      const description = MESSAGES[locale].createDraftDescription
      expect(description).toContain('sale.order')
      expect(description).toContain('project.task')
      expect(description).toContain('state')
      expect(description).toContain('stage_id')
    }
  })

  it('states the dot restriction and the archived-record rule in every locale', () => {
    for (const locale of LOCALES) {
      const description = MESSAGES[locale].searchReadDescription
      expect(description).toMatch(/\bin\b/)
      expect(description.length).toBeGreaterThan(80)
    }
  })

  it('falls back to English for an unknown locale', () => {
    expect(odooMessages('xx' as never)).toBe(MESSAGES.en)
  })
})

describe('config schema locales', () => {
  it('describes every config field in four languages', () => {
    for (const key of ['en', 'zh-TW', 'zh-CN', 'ja'] as const) {
      expect(CONFIG_I18N[key].$description.length).toBeGreaterThan(0)
      expect(CONFIG_I18N[key].apiKey).toContain('ODOO_API_KEY')
    }
  })
})
