import { describe, expect, it } from 'vitest'

import type { ApiResult, JsonObject } from '../src/types.js'

describe('types module', () => {
  it('models an ApiResult with data and meta', () => {
    const result: ApiResult<JsonObject> = {
      data: { id: 1 },
      meta: { model: 'res.partner', total: 1, returned: 1, offset: 0 },
    }

    expect(result.data).toEqual({ id: 1 })
    expect(result.meta.model).toBe('res.partner')
  })
})
