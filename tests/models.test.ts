import { describe, expect, it } from 'vitest'

import {
  BINARY_FIELDS,
  CREATE_FIELDS,
  CREATE_READBACK_FIELDS,
  DEFAULT_FIELDS,
  FORBIDDEN_CREATE_FIELDS,
  isReadModel,
  isWriteModel,
  READ_MODELS,
  WRITE_MODELS,
} from '../src/models.js'

describe('read model allow list', () => {
  it('contains exactly the fourteen specified models', () => {
    expect(READ_MODELS).toHaveLength(14)
    expect(new Set(READ_MODELS).size).toBe(14)
    expect(READ_MODELS).toContain('res.partner')
    expect(READ_MODELS).toContain('stock.quant')
  })

  it('recognises only allow-listed models', () => {
    expect(isReadModel('sale.order')).toBe(true)
    expect(isReadModel('ir.attachment')).toBe(false)
    expect(isReadModel(42)).toBe(false)
  })

  it('defines default fields for every allow-listed model', () => {
    for (const model of READ_MODELS) {
      expect(DEFAULT_FIELDS[model].length).toBeGreaterThan(0)
      expect(DEFAULT_FIELDS[model]).toContain('id')
    }
  })

  it('never defaults to the active flag or a binary field', () => {
    for (const model of READ_MODELS) {
      expect(DEFAULT_FIELDS[model]).not.toContain('active')
      for (const field of DEFAULT_FIELDS[model]) {
        expect(BINARY_FIELDS.has(field)).toBe(false)
      }
    }
  })
})

describe('write model rules', () => {
  it('allows only sale.order and project.task', () => {
    expect(WRITE_MODELS).toEqual(['sale.order', 'project.task'])
    expect(isWriteModel('res.partner')).toBe(false)
  })

  it('forbids state on sale.order and state plus stage_id on project.task', () => {
    expect(FORBIDDEN_CREATE_FIELDS['sale.order']).toEqual(['state'])
    expect(FORBIDDEN_CREATE_FIELDS['project.task']).toEqual(['state', 'stage_id'])
  })

  it('never lets a forbidden field also appear in the create allow list', () => {
    for (const model of WRITE_MODELS) {
      for (const field of FORBIDDEN_CREATE_FIELDS[model]) {
        expect(CREATE_FIELDS[model][field as never]).toBeUndefined()
      }
    }
  })

  it('marks the required create fields', () => {
    expect(CREATE_FIELDS['sale.order'].partner_id?.required).toBe(true)
    expect(CREATE_FIELDS['project.task'].name?.required).toBe(true)
    expect(CREATE_FIELDS['project.task'].project_id?.required).toBe(true)
  })

  it('reads back the created record with a small field set', () => {
    expect(CREATE_READBACK_FIELDS['sale.order']).toEqual(['id', 'name', 'state'])
    expect(CREATE_READBACK_FIELDS['project.task']).toEqual(['id', 'name', 'stage_id'])
  })
})
