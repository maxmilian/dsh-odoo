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

  const DOT_RESTRICTION = {
    en: 'may not contain dots',
    'zh-TW': '不得含點號',
    'zh-CN': '不得包含点号',
    ja: 'ドットは使えない',
  } as const

  const ARCHIVED_RULE = {
    en: 'Only non-archived records are returned',
    'zh-TW': '只會回傳未封存的記錄',
    'zh-CN': '只会返回未归档的记录',
    ja: 'アーカイブされていないレコードのみを返します',
  } as const

  it('states the dot restriction in every locale', () => {
    for (const locale of LOCALES) {
      expect(MESSAGES[locale].searchReadDescription, locale).toContain(DOT_RESTRICTION[locale])
    }
  })

  it('states the archived-record rule in every locale', () => {
    for (const locale of LOCALES) {
      expect(MESSAGES[locale].searchReadDescription, locale).toContain(ARCHIVED_RULE[locale])
    }
  })

  const DEFAULT_STAGE = {
    en: 'default stage',
    'zh-TW': '預設階段',
    'zh-CN': '默认阶段',
    ja: '既定のステージ',
  } as const

  const FIRST_STAGE = {
    en: 'first stage',
    'zh-TW': '第一個階段',
    'zh-CN': '第一个阶段',
    ja: '最初のステージ',
  } as const

  it('promises only the Odoo default stage for a project task', () => {
    for (const locale of LOCALES) {
      const description = MESSAGES[locale].createDraftDescription
      expect(description, locale).toContain(DEFAULT_STAGE[locale])
      expect(description, locale).not.toContain(FIRST_STAGE[locale])
    }
  })

  const MODULE_CAVEAT = {
    en: 'only if its module is installed',
    'zh-TW': '僅在該 Odoo 安裝了對應模組時才存在',
    'zh-CN': '仅在该 Odoo 安装了对应模块时才存在',
    ja: 'そのモジュールがインストールされている場合にのみ存在します',
  } as const

  it('warns that an allow-listed model may not exist on this Odoo', () => {
    for (const locale of LOCALES) {
      expect(MESSAGES[locale].searchReadDescription, locale).toContain(MODULE_CAVEAT[locale])
      expect(MESSAGES[locale].describeModelDescription, locale).toContain(MODULE_CAVEAT[locale])
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
