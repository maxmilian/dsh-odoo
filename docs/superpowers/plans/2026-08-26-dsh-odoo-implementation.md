# dsh-odoo v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 從零建立 `dsh-odoo`——一個唯讀為主的 DeepSeek Harness Odoo 插件，提供 3 個唯讀工具與 1 個預設關閉的受限草稿建立工具。

**Architecture:** 單一 Cordis plugin。`apply()` 建立**一個** `OdooClient` 實例（eager），把它連同 locale / allowWrite 交給 `createOdooTools()` 產出工具陣列後逐一註冊。Client 走 JSON-RPC（`POST {baseUrl}jsonrpc`）打 Odoo，內部持有兩份 per-plugin-instance 快取：handshake（uid）與欄位型別（`Map<model, Map<field, type>>`）。所有輸入驗證集中在 `domain.ts`，所有錯誤集中在 `errors.ts`，所有面向使用者的文案集中在 `locales.ts`。**零 runtime 依賴**，只用 `fetch` + `JSON`。

**Tech Stack:** TypeScript 5.9（NodeNext、strict）、Bun 1.3.5（套件管理與執行）、vitest 4（測試，mock fetch）、Biome 2.5（lint + format）、peer deps `@deepseek-ai/cordis` / `@deepseek-ai/dsh-tools` / `@deepseek-ai/schemastery`。

**Spec:** `docs/superpowers/specs/2026-08-26-dsh-odoo-design.md`（**執行者必須先讀完這份 spec**，本計畫的每個決定都在 spec 裡有理由）

**骨架來源：** `~/side/ankey/dsh-sonarqube`（可讀）。tsconfig / biome / vitest.config / .gitignore / LICENSE / workflows **直接複製再改名**，不要重新發明。`config.ts` / `errors.ts` / `locales.ts` 三塊的結構複用度最高。

---

## Global Constraints

- Node.js `^22.19.0 || >=24.0.0`；packageManager `bun@1.3.5`
- **零 runtime dependencies**。`@deepseek-ai/*` 一律放 `peerDependencies`，範圍必須顯式列出 prerelease 分支：`"@deepseek-ai/dsh-tools": "^0.1.0-rc.8 || ^0.1.1-rc.2"`（單寫 `^0.1.0-rc.8` 會被 node-semver 靜默排除 `0.1.1-rc.2` → 使用者 ERESOLVE）
- `package.json` **必須**含 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`（registry 硬性要求；只宣告 `dsh.client` 會被退件）
- npm 套件名 `dsh-odoo`（unscoped，已確認未被佔用）；npm 帳號 `maxhsu`，GitHub 帳號 `maxmilian`
- License：MIT
- 四語 README：`README.md`(en) / `README.zh-TW.md` / `README.zh-CN.md` / `README.ja.md`
- **G1**：tool `name` 固定英文；`description`、每個參數的 `description`、`presentCall.title` 依 `config.locale`（`en` / `zh-TW` / `zh-CN` / `ja`）切換。**錯誤訊息豁免——一律英文靜態，不翻譯。**
- **G2**：只有 HTTP 400、`odoo.exceptions.UserError` / `ValidationError`、`builtins.ValueError` / `KeyError` 這三類會把上游 `error.data.message` 透出，且**先 redact 再截斷至 200 字元**
- 所有工具 `isConcurrencySafe: () => true`；輸出統一 `{ data, meta }` 並 render 成單一 JSON text
- `presentCall` **只有** `odoo_create_draft` 有，`kind: 'edit'`（`ToolCallKind` 沒有 `'write'`，寫了 typecheck 會掛）
- Biome 規則：`noConsole: error`、`noExplicitAny: error`、cognitive complexity ≤ 10 → **函式要拆小**
- 每個 Task 結束前四個指令都要綠：`bun run lint` / `bun run typecheck` / `bun run test` / `bun run build`
- TDD：每一步先寫失敗測試 → 跑到紅 → 最小實作 → 跑到綠 → commit
- Commit message 用 Conventional Commits（`feat:` / `test:` / `chore:` / `docs:`），無 ClickUp 單號

---

## File Structure

| 檔案 | 責任 | 由哪個 Task 建立 |
| --- | --- | --- |
| `package.json`、`tsconfig.json`、`tsconfig.build.json`、`biome.json`、`vitest.config.ts`、`.gitignore`、`LICENSE`、`cordis.patch.yml` | 專案骨架 | Task 1 |
| `src/types.ts` | `JsonValue` / `JsonObject` / `ApiMeta` / `ApiResult` / 參數型別 | Task 1 |
| `src/errors.ts` | `OdooApiError`、19 個 error code、HTTP 與 Odoo exception 對應、`sanitizeDetail`（G2） | Task 2 |
| `src/config.ts` | config 解析與兩段式驗證、所有上下界常數、`LOCALES` | Task 3 |
| `src/models.ts` | 14 個唯讀 model 白名單、`DEFAULT_FIELDS`、`BINARY_FIELDS` 快速路徑、create 欄位規則表 | Task 4 |
| `src/domain.ts` | **所有輸入驗證**：domain（含 arity）、fields、order、分頁、日期、create values | Task 5 |
| `src/rpc.ts` | JSON-RPC 傳輸：fetch、timeout、bounded body、redirect manual、error 解包 | Task 6 |
| `src/client.ts` | handshake/uid/companyId 驗證、欄位型別快取、`serverInfo` / `describeModel` / `searchRead` / `createDraft`、回應裁剪 | Task 7–10 |
| `src/locales.ts` | `CONFIG_I18N` + 四語 `OdooMessages` | Task 11 |
| `src/tools.ts` | `createOdooTools(client, locale, allowWrite)` → 3 或 4 個 tool definition | Task 12 |
| `src/index.ts` | Cordis 入口：`name` / `inject` / `Config` schema / `apply` / 公開 re-export | Task 13 |
| `README.md` ×4、`.github/workflows/ci.yml`、`.github/workflows/release.yml` | 文件與 CI/CD | Task 14 |

測試檔對應 spec §8：`tests/types.test.ts`（Task 1）、`errors.test.ts`（2）、`config.test.ts`（3）、`models.test.ts`（4）、`domain.test.ts`（5）、`rpc.test.ts`（6）、`client.test.ts`（7–10，逐 Task 追加 describe 區塊）、`locales.test.ts`（11）、`tools.test.ts`（12）、`plugin.test.ts`（13）。

---

## Task 1: 專案骨架與型別基礎

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `biome.json`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `cordis.patch.yml`, `src/types.ts`, `tests/types.test.ts`

**Interfaces:**
- Consumes: 無（第一個 task）
- Produces: `src/types.ts` 匯出 `JsonValue`、`JsonObject`、`ApiMeta`、`ApiResult<T>`、`SearchReadParams`、`CreateDraftParams`

- [ ] **Step 1: 複製骨架設定檔**

從 `~/side/ankey/dsh-sonarqube` 複製，**內容不改**：

```bash
cp ~/side/ankey/dsh-sonarqube/tsconfig.json .
cp ~/side/ankey/dsh-sonarqube/tsconfig.build.json .
cp ~/side/ankey/dsh-sonarqube/biome.json .
cp ~/side/ankey/dsh-sonarqube/vitest.config.ts .
cp ~/side/ankey/dsh-sonarqube/.gitignore .
cp ~/side/ankey/dsh-sonarqube/LICENSE .
```

`vitest.config.ts` 已含 80% 四項覆蓋率門檻與 `exclude: ['src/types.ts']`，不用改。

- [ ] **Step 2: 建立 `package.json`**

```json
{
  "name": "dsh-odoo",
  "version": "0.1.0",
  "description": "Read-only Odoo tools for DeepSeek Harness, with an opt-in restricted draft-create tool.",
  "homepage": "https://github.com/maxmilian/dsh-odoo#readme",
  "bugs": { "url": "https://github.com/maxmilian/dsh-odoo/issues" },
  "repository": { "type": "git", "url": "git+https://github.com/maxmilian/dsh-odoo.git" },
  "author": "maxmilian",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./package.json": "./package.json"
  },
  "files": [
    "lib",
    "cordis.patch.yml",
    "README.md",
    "README.zh-TW.md",
    "README.zh-CN.md",
    "README.ja.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "format": "biome format --write .",
    "lint": "biome check .",
    "prepare": "bun run build",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "keywords": ["deepseek-harness", "dsh-plugin", "odoo", "erp", "crm"],
  "license": "MIT",
  "packageManager": "bun@1.3.5",
  "engines": { "node": "^22.19.0 || >=24.0.0" },
  "publishConfig": { "access": "public" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.8 || ^0.1.1-rc.2",
    "@deepseek-ai/schemastery": "^3.18.1"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- [ ] **Step 3: 建立 `cordis.patch.yml`**

只有 id 與 name，**不要預塞 config 區塊**（spec §5.2：預塞空字串會讓「裝了但還沒填設定」的使用者在載入期炸掉；欄位顯示交給 Schemastery 的 `.default()`）：

```yaml
- insert:
    - id: dsh-odoo
      name: dsh-odoo
```

- [ ] **Step 4: 安裝 devDependencies**

```bash
bun add -d @biomejs/biome@^2.5.10 @deepseek-ai/cordis@^4.0.1 @deepseek-ai/dsh-tools@^0.1.0-rc.8 @deepseek-ai/schemastery@^3.18.1 @types/node@^24.10.1 @vitest/coverage-v8@^4.0.18 typescript@^5.9.3 vitest@^4.0.18
```

- [ ] **Step 5: 寫失敗測試 `tests/types.test.ts`**

```ts
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
```

- [ ] **Step 6: 跑測試確認失敗**

Run: `bun run test`
Expected: FAIL — `Cannot find module '../src/types.js'`

- [ ] **Step 7: 建立 `src/types.ts`**

```ts
import type { JsonValue as DshJsonValue } from '@deepseek-ai/dsh-tools'

/** The canonical lossless JSON value accepted by DeepSeek Harness tool output. */
export type JsonValue = DshJsonValue

/** A JSON object with string keys. */
export type JsonObject = { [key: string]: JsonValue }

/** Safe response metadata exposed by every Odoo client method. */
export interface ApiMeta {
  readonly model?: string
  readonly total?: number
  readonly returned?: number
  readonly offset?: number
  readonly truncatedFields?: readonly string[]
  readonly truncated?: boolean
  readonly odooVersion?: string
}

/** Canonical response returned by every Odoo client method. */
export interface ApiResult<T extends JsonValue = JsonValue> {
  readonly data: T
  readonly meta: ApiMeta
}

/** Parameters accepted by the restricted search_read. */
export interface SearchReadParams {
  readonly model: string
  readonly domain?: readonly JsonValue[]
  readonly fields?: readonly string[]
  readonly limit?: number
  readonly offset?: number
  readonly order?: string
}

/** Parameters accepted by the opt-in draft creation. */
export interface CreateDraftParams {
  readonly model: string
  readonly values: JsonObject
}
```

- [ ] **Step 8: 跑四個驗證指令**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
```
Expected: 四個全綠；`lib/types.js` 與 `lib/types.d.ts` 產生。

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold package, tooling configs, and shared types"
```

---

## Task 2: `errors.ts` — 19 個 error code 與 G2 淨化管線

**Files:**
- Create: `src/errors.ts`, `tests/errors.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `type OdooErrorCode`（19 個字面值）
  - `class OdooApiError extends Error`：`code`、`status?`、`model?`、`odooException?`、`retryAfter?`、`detail?`、`toJSON()`
  - `const MAX_DETAIL_CHARS = 200`
  - `function truncateDetail(value: string): string`
  - `function sanitizeDetail(raw: unknown, apiKey?: string): string | undefined`
  - `function configError(message: string): OdooApiError`
  - `function inputError(message: string): OdooApiError`
  - `function createHttpError(status: number, options?: { retryAfter?: string; detail?: string }): OdooApiError`
  - `function createRpcError(rpcError: unknown, apiKey?: string): OdooApiError`

- [ ] **Step 1: 寫失敗測試 `tests/errors.test.ts`**

```ts
import { describe, expect, it } from 'vitest'

import {
  createHttpError,
  createRpcError,
  MAX_DETAIL_CHARS,
  OdooApiError,
  sanitizeDetail,
} from '../src/errors.js'

const rpc = (name: string, message: string) => ({
  code: 200,
  message: 'Odoo Server Error',
  data: { name, message },
})

describe('OdooApiError', () => {
  it('exposes only safe fields through toJSON', () => {
    const error = new OdooApiError('boom', {
      code: 'ODOO_RPC_ERROR',
      status: 200,
      model: 'sale.order',
    })

    expect(error.name).toBe('OdooApiError')
    expect(error.toJSON()).toEqual({
      name: 'OdooApiError',
      code: 'ODOO_RPC_ERROR',
      status: 200,
      model: 'sale.order',
      odooException: undefined,
      retryAfter: undefined,
      detail: undefined,
    })
  })
})

describe('HTTP error mapping', () => {
  it.each([
    [401, 'AUTHENTICATION_FAILED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVER_ERROR'],
    [418, 'ODOO_HTTP_ERROR'],
    [400, 'ODOO_HTTP_ERROR'],
  ])('maps HTTP %i to %s', (status, code) => {
    expect(createHttpError(status).code).toBe(code)
  })

  it('attaches detail only for HTTP 400', () => {
    expect(createHttpError(400, { detail: 'bad domain' }).detail).toBe('bad domain')
    expect(createHttpError(403, { detail: 'bad domain' }).detail).toBeUndefined()
    expect(createHttpError(500, { detail: 'stack trace' }).detail).toBeUndefined()
  })

  it('keeps the Retry-After hint on 429', () => {
    expect(createHttpError(429, { retryAfter: '30' }).retryAfter).toBe('30')
  })
})

describe('JSON-RPC error mapping', () => {
  it.each([
    ['odoo.exceptions.AccessDenied', 'AUTHENTICATION_FAILED', false],
    ['odoo.exceptions.AccessError', 'PERMISSION_DENIED', false],
    ['odoo.exceptions.MissingError', 'NOT_FOUND', false],
    ['odoo.exceptions.UserError', 'ODOO_VALIDATION_ERROR', true],
    ['odoo.exceptions.ValidationError', 'ODOO_VALIDATION_ERROR', true],
    ['builtins.ValueError', 'ODOO_QUERY_ERROR', true],
    ['builtins.KeyError', 'ODOO_QUERY_ERROR', true],
    ['builtins.RuntimeError', 'ODOO_RPC_ERROR', false],
  ])('maps %s to %s (detail exposed: %s)', (name, code, exposed) => {
    const error = createRpcError(rpc(name, "Invalid field 'nope' on model 'sale.order'"))

    expect(error.code).toBe(code)
    expect(error.odooException).toBe(name)
    expect(error.detail === undefined).toBe(!exposed)
    if (exposed) expect(error.message).toContain('Odoo said:')
  })

  it('falls back to ODOO_RPC_ERROR when data.name is missing', () => {
    expect(createRpcError({ message: 'nope' }).code).toBe('ODOO_RPC_ERROR')
  })
})

describe('sanitizeDetail', () => {
  it('returns undefined for non-strings and blank input', () => {
    expect(sanitizeDetail(undefined)).toBeUndefined()
    expect(sanitizeDetail(42)).toBeUndefined()
    expect(sanitizeDetail('   ')).toBeUndefined()
  })

  it('collapses whitespace and control characters', () => {
    expect(sanitizeDetail('a\n\tb   c')).toBe('a b c')
  })

  it('redacts the matched substring, not the whole message', () => {
    const detail = sanitizeDetail('Invalid field on model, token=abc123secret')

    expect(detail).toContain('Invalid field on model,')
    expect(detail).toContain('[redacted]')
    expect(detail).not.toContain('abc123secret')
  })

  it('redacts the configured api key verbatim', () => {
    expect(sanitizeDetail('key is 1a2b3c', '1a2b3c')).toBe('key is [redacted]')
  })

  it('redacts long opaque tokens', () => {
    expect(sanitizeDetail('value abcdefghijklmnopqrstuvwx here')).toBe('value [redacted] here')
  })

  it('truncates to the 200 character cap', () => {
    const detail = sanitizeDetail(Array.from({ length: 200 }, () => 'x y').join(' '))

    expect(detail).toHaveLength(MAX_DETAIL_CHARS)
    expect(detail?.endsWith('...')).toBe(true)
  })

  it('redacts before truncating so a secret cannot survive on the boundary', () => {
    const secret = 'S3CR3TS3CR3TS3CR3TS3CR3T'
    const filler = Array.from({ length: 95 }, () => 'ab').join(' ')
    const detail = sanitizeDetail(`${filler} ${secret}`, secret)

    expect(detail).not.toContain('S3CR3T')
  })
})
```

> 註：`truncates to the 200 character cap` 與 `redacts before truncating` 兩個案例刻意用「短 token 組成的長字串」，
> 避免整串 `x` 被 `[A-Za-z0-9_-]{20,}` 規則當成密鑰整段 redact 掉而測不到截斷。

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/errors.test.ts`
Expected: FAIL — `Cannot find module '../src/errors.js'`

- [ ] **Step 3: 實作 `src/errors.ts`**

19 個 code（順序照 spec §6.1）：

```ts
export type OdooErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_INPUT'
  | 'AUTHENTICATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_ABORTED'
  | 'NETWORK_ERROR'
  | 'RESPONSE_TOO_LARGE'
  | 'INVALID_RESPONSE'
  | 'SERVER_ERROR'
  | 'ODOO_RPC_ERROR'
  | 'ODOO_VALIDATION_ERROR'
  | 'ODOO_QUERY_ERROR'
  | 'MODEL_NOT_ALLOWED'
  | 'WRITE_DISABLED'
  | 'TRANSPORT_UNSUPPORTED'
  | 'ODOO_HTTP_ERROR'
```

`OdooApiError` 完全比照 dsh-sonarqube 的 `SonarQubeApiError`：constructor 設 `this.name = 'OdooApiError'`，
`toJSON()` 回傳固定 7 個 key（`name` / `code` / `status` / `model` / `odooException` / `retryAfter` / `detail`）。

G2 的表與淨化管線：

```ts
/** Maximum characters exposed from an upstream error message. */
export const MAX_DETAIL_CHARS = 200

const REDACTED = '[redacted]'

const SECRET_PATTERNS: readonly RegExp[] = [
  /(?:api[_-]?key|token|password|secret|authorization|bearer)\s*[:=]\s*\S+/gi,
  /[A-Za-z0-9_-]{20,}/g,
]

/** Odoo exception name to stable error code. */
const EXCEPTION_CODES: Readonly<Record<string, OdooErrorCode>> = {
  'odoo.exceptions.AccessDenied': 'AUTHENTICATION_FAILED',
  'odoo.exceptions.AccessError': 'PERMISSION_DENIED',
  'odoo.exceptions.MissingError': 'NOT_FOUND',
  'odoo.exceptions.UserError': 'ODOO_VALIDATION_ERROR',
  'odoo.exceptions.ValidationError': 'ODOO_VALIDATION_ERROR',
  'builtins.ValueError': 'ODOO_QUERY_ERROR',
  'builtins.KeyError': 'ODOO_QUERY_ERROR',
}

/** Codes whose upstream message may be exposed to the agent (G2). */
const DETAIL_CODES: ReadonlySet<OdooErrorCode> = new Set<OdooErrorCode>([
  'ODOO_VALIDATION_ERROR',
  'ODOO_QUERY_ERROR',
])

/** Truncates an already-sanitized string to the exposure cap. */
export function truncateDetail(value: string): string {
  return value.length <= MAX_DETAIL_CHARS ? value : `${value.slice(0, MAX_DETAIL_CHARS - 3)}...`
}

/** Redacts secrets from an upstream message, then truncates it. Order matters. */
export function sanitizeDetail(raw: unknown, apiKey = ''): string | undefined {
  if (typeof raw !== 'string') return undefined
  let text = raw.replace(/\s+/g, ' ').trim()
  if (apiKey.length > 0) text = text.split(apiKey).join(REDACTED)
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, REDACTED)
  text = truncateDetail(text).trim()
  return text.length > 0 ? text : undefined
}
```

注意 `\s` 在 JS regex 已涵蓋 `\n` / `\t` / `\r`；若要一併吃掉其他控制字元，
再加一條 `text = text.replace(new RegExp('[\\u0000-\\u001f]+', 'g'), ' ')`（用 `new RegExp` 字串形式，
避免在原始碼裡放裸控制字元）。

`createHttpError(status, options)`：狀態碼 → code 與靜態英文訊息（比照 dsh-sonarqube 的 `describeHttpError`），
`retryAfter` 原樣帶上，**只有 `status === 400` 才帶 `options.detail`**。

`createRpcError(rpcError, apiKey)` 的四步：
1. 從 `rpcError.data.name`（型別守衛確認是 string）查 `EXCEPTION_CODES`，查不到或缺失 → `ODOO_RPC_ERROR`
2. 靜態英文訊息由 code 決定，例如：
   - `ODOO_QUERY_ERROR` → `Odoo rejected the query.`
   - `ODOO_VALIDATION_ERROR` → `Odoo rejected the values.`
   - `PERMISSION_DENIED` → `Odoo denied access to this resource.`
   - `NOT_FOUND` → `The requested Odoo record no longer exists.`
   - `AUTHENTICATION_FAILED` → `Odoo rejected the credentials. Check db, username, and apiKey.`
   - `ODOO_RPC_ERROR` → `The Odoo server returned an RPC error.`
3. 只有 `DETAIL_CODES.has(code)` 時才 `sanitizeDetail(data.message ?? rpcError.message, apiKey)`
4. 有 detail 時 `message` 串成 `` `${staticMessage} Odoo said: ${detail}` ``

`configError` / `inputError`：

```ts
export function configError(message: string): OdooApiError {
  return new OdooApiError(`Invalid Odoo configuration: ${message}`, { code: 'INVALID_CONFIG' })
}

export function inputError(message: string): OdooApiError {
  return new OdooApiError(`Invalid Odoo input: ${message}`, { code: 'INVALID_INPUT' })
}
```

**Biome 提醒**：`createRpcError` 寫成一長串 if 會超過 cognitive complexity 10——
把「code 解析」「靜態訊息查表」「detail 取得」拆成三個小函式。

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/errors.test.ts`
Expected: PASS（全部 case）

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: add OdooApiError with 19 codes and the G2 detail sanitizer"
```

---

## Task 3: `config.ts` — 兩段式驗證

**Files:**
- Create: `src/config.ts`, `tests/config.test.ts`

**Interfaces:**
- Consumes: `configError` from `src/errors.js`
- Produces:
  - 常數：`DEFAULT_REQUEST_TIMEOUT_MS = 30_000`、`MAX_REQUEST_TIMEOUT_MS = 300_000`、`DEFAULT_MAX_RESPONSE_BYTES = 1_000_000`、`MAX_RESPONSE_BYTES = 52_428_800`、`DEFAULT_LIMIT = 20`、`MAX_LIMIT = 100`、`MAX_OFFSET = 10_000`、`MAX_SEARCH_RESULTS = 10_000`
  - `const LOCALES = ['en', 'zh-TW', 'zh-CN', 'ja'] as const`、`type Locale = (typeof LOCALES)[number]`
  - `interface OdooConfig`（欄位全 optional，plugin 傳入的形狀）
  - `interface ResolvedOdooConfig`：`baseUrl: string`、`db: string`、`username: string`、`apiKey: string`、`companyId?: number`、`allowWrite: boolean`、`locale: Locale`、`defaultLimit: number`、`requestTimeoutMs: number`、`maxResponseBytes: number`
  - `function resolveConfig(config?: OdooConfig, env?: NodeJS.ProcessEnv): ResolvedOdooConfig`（**apply 期**：只驗「填了就要合法」）
  - `function assertCredentials(config: ResolvedOdooConfig): void`（**handshake 期**：四個憑證欄位缺一就丟 `INVALID_CONFIG`）

- [ ] **Step 1: 寫失敗測試 `tests/config.test.ts`**

```ts
import { describe, expect, it } from 'vitest'

import { assertCredentials, resolveConfig } from '../src/config.js'
import { OdooApiError } from '../src/errors.js'

const FULL_ENV = {
  ODOO_URL: 'https://env.example.com/odoo',
  ODOO_DB: 'envdb',
  ODOO_USERNAME: 'env-user',
  ODOO_API_KEY: 'env-key',
}

describe('resolveConfig', () => {
  it('prefers plugin config over environment variables', () => {
    const resolved = resolveConfig(
      { baseUrl: 'https://config.example.com/', db: 'cfgdb', username: 'cfg', apiKey: 'cfg-key' },
      FULL_ENV,
    )

    expect(resolved).toMatchObject({
      baseUrl: 'https://config.example.com/',
      db: 'cfgdb',
      username: 'cfg',
      apiKey: 'cfg-key',
      allowWrite: false,
      locale: 'en',
      defaultLimit: 20,
      requestTimeoutMs: 30_000,
      maxResponseBytes: 1_000_000,
    })
  })

  it('falls back to environment variables and normalizes the base URL', () => {
    expect(resolveConfig({}, FULL_ENV).baseUrl).toBe('https://env.example.com/odoo/')
  })

  it('normalizes repeated trailing slashes', () => {
    expect(resolveConfig({ baseUrl: 'https://odoo.example.com/erp///' }, {}).baseUrl).toBe(
      'https://odoo.example.com/erp/',
    )
  })

  it('ignores the environment for allowWrite', () => {
    expect(resolveConfig({}, { ...FULL_ENV, ODOO_ALLOW_WRITE: 'true' }).allowWrite).toBe(false)
  })

  it('parses companyId from the environment', () => {
    expect(resolveConfig({}, { ...FULL_ENV, ODOO_COMPANY_ID: '3' }).companyId).toBe(3)
  })

  it('does not throw when credentials are missing', () => {
    const resolved = resolveConfig({}, {})

    expect(resolved.baseUrl).toBe('')
    expect(resolved.db).toBe('')
    expect(resolved.username).toBe('')
    expect(resolved.apiKey).toBe('')
  })

  it.each([
    [{ baseUrl: 'ftp://odoo.example.com' }, {}],
    [{ baseUrl: 'https://user:pass@odoo.example.com' }, {}],
    [{ baseUrl: 'https://odoo.example.com?db=x' }, {}],
    [{ baseUrl: 'https://odoo.example.com#frag' }, {}],
    [{ requestTimeoutMs: 0 }, {}],
    [{ requestTimeoutMs: 300_001 }, {}],
    [{ maxResponseBytes: 52_428_801 }, {}],
    [{ defaultLimit: 0 }, {}],
    [{ defaultLimit: 101 }, {}],
    [{ companyId: 0 }, {}],
    [{ locale: 'de' as never }, {}],
    [{}, { ODOO_COMPANY_ID: 'abc' }],
  ])('rejects invalid config %#', (config, env) => {
    expect(() => resolveConfig(config, env)).toThrowError(OdooApiError)
  })
})

describe('assertCredentials', () => {
  it('passes when every credential is present', () => {
    expect(() => assertCredentials(resolveConfig({}, FULL_ENV))).not.toThrow()
  })

  it.each(['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY'])(
    'throws when %s is missing',
    (missing) => {
      const config = resolveConfig({}, { ...FULL_ENV, [missing]: '' })

      expect(() => assertCredentials(config)).toThrowError(/Set baseUrl\/db\/username\/apiKey/)
    },
  )
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 3: 實作 `src/config.ts`**

結構直接照 dsh-sonarqube 的 `config.ts`（`resolveConfig` → `validateResolvedConfig` → `normalizeBaseUrl` +
`assertBoundedInteger`），差別有四：

1. 欄位多了 `db` / `username` / `apiKey` / `companyId` / `allowWrite` / `locale` / `defaultLimit`
2. **`baseUrl` 為空字串時不報錯也不正規化**；非空才走 `normalizeBaseUrl`
   （抄 sonarqube 那份，錯誤訊息把 `SonarQube` 換成 `Odoo`：非 http(s) / 含帳密 / 含 query 或 fragment 三種）
3. `db` / `username` / `apiKey` 為空字串時不報錯（延到 `assertCredentials`）；非空時驗長度
   （`db` ≤ 100、`username` ≤ 200、`apiKey` ≤ 200，超過 → `configError`）
4. `assertCredentials` 是獨立匯出函式：

```ts
/** Fails when a credential needed for the JSON-RPC handshake is missing. */
export function assertCredentials(config: ResolvedOdooConfig): void {
  const missing = (['baseUrl', 'db', 'username', 'apiKey'] as const).filter(
    (key) => config[key].length === 0,
  )
  if (missing.length > 0) {
    throw configError(
      'Set baseUrl/db/username/apiKey, or the ODOO_URL/ODOO_DB/ODOO_USERNAME/ODOO_API_KEY environment variables.',
    )
  }
}
```

`companyId`：config 傳入的直接驗，env 的用 `Number.parseInt(value, 10)`；
兩者都要 `Number.isSafeInteger` 且 `1 <= value <= 2_147_483_647`，否則
`configError('companyId must be a positive integer.')`。未設定則 `ResolvedOdooConfig.companyId` 為 `undefined`。

`locale` 不在 `LOCALES` 內 → `configError('locale must be one of en, zh-TW, zh-CN, ja.')`。

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: resolve Odoo config with two-stage validation"
```

---

## Task 4: `models.ts` — 白名單與欄位規則表

**Files:**
- Create: `src/models.ts`, `tests/models.test.ts`

**Interfaces:**
- Consumes: 無
- Produces:
  - `const READ_MODELS`（14 個，`as const`）、`type ReadModel = (typeof READ_MODELS)[number]`
  - `function isReadModel(value: unknown): value is ReadModel`
  - `const DEFAULT_FIELDS: Readonly<Record<ReadModel, readonly string[]>>`
  - `const BINARY_FIELDS: ReadonlySet<string>`
  - `const WRITE_MODELS = ['sale.order', 'project.task'] as const`、`type WriteModel = (typeof WRITE_MODELS)[number]`
  - `function isWriteModel(value: unknown): value is WriteModel`
  - `interface FieldRule { kind: 'int' | 'string' | 'date' | 'intArray'; required?: boolean; maxLength?: number; maxItems?: number }`
  - `const CREATE_FIELDS: Readonly<Record<WriteModel, Readonly<Record<string, FieldRule>>>>`
  - `const FORBIDDEN_CREATE_FIELDS: Readonly<Record<WriteModel, readonly string[]>>`
  - `const CREATE_READBACK_FIELDS: Readonly<Record<WriteModel, readonly string[]>>`
  - 上限常數：`MAX_FIELDS = 30`、`MAX_DOMAIN_LENGTH = 40`、`MAX_DOMAIN_LEAVES = 20`、`MAX_VALUE_LENGTH = 200`、`MAX_IN_VALUES = 100`、`MAX_STRING_CHARS = 2000`、`MAX_DESCRIBE_FIELDS = 200`、`MAX_SELECTION_OPTIONS = 30`、`MAX_ORDER_TERMS = 3`

- [ ] **Step 1: 寫失敗測試 `tests/models.test.ts`**

```ts
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
        expect(CREATE_FIELDS[model][field]).toBeUndefined()
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/models.test.ts`
Expected: FAIL — `Cannot find module '../src/models.js'`

- [ ] **Step 3: 實作 `src/models.ts`**

`READ_MODELS` 與 `DEFAULT_FIELDS` **完全照 spec §11 的表格抄**（14 個 model；
`res.users` / `product.product` / `project.project` 都**不含** `active`）：

```ts
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
```

`BINARY_FIELDS`（快速路徑；真正的保證來自 Task 8 的型別快取）：

```ts
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
```

`CREATE_FIELDS`（照 spec §4.6）：

```ts
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

export const FORBIDDEN_CREATE_FIELDS = {
  'sale.order': ['state'],
  'project.task': ['state', 'stage_id'],
} as const satisfies Record<WriteModel, readonly string[]>

export const CREATE_READBACK_FIELDS = {
  'sale.order': ['id', 'name', 'state'],
  'project.task': ['id', 'name', 'stage_id'],
} as const satisfies Record<WriteModel, readonly string[]>
```

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/models.test.ts`
Expected: PASS

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: add Odoo model allow list and field rule tables"
```

---

## Task 5: `domain.ts` — 全部輸入驗證（含 arity 與禁點號）

**Files:**
- Create: `src/domain.ts`, `tests/domain.test.ts`

**Interfaces:**
- Consumes: `inputError` / `truncateDetail` from `src/errors.js`；`MAX_*` 常數與 `CREATE_FIELDS` / `FORBIDDEN_CREATE_FIELDS` from `src/models.js`；`MAX_LIMIT` / `MAX_OFFSET` / `MAX_SEARCH_RESULTS` from `src/config.js`
- Produces:
  - `function validateDomain(domain: unknown, knownFields: ReadonlySet<string>): JsonValue[]`
  - `function validateFields(fields: readonly string[] | undefined, model: ReadModel, fieldTypes: ReadonlyMap<string, string>): readonly string[]`
  - `function validateOrder(order: string | undefined, knownFields: ReadonlySet<string>): string | undefined`
  - `function validatePagination(limit: number | undefined, offset: number | undefined, defaultLimit: number): { limit: number; offset: number }`
  - `function validateCreateValues(model: WriteModel, values: unknown): JsonObject`

- [ ] **Step 1: 寫失敗測試 `tests/domain.test.ts`**

```ts
import { describe, expect, it } from 'vitest'

import {
  validateCreateValues,
  validateDomain,
  validateFields,
  validateOrder,
  validatePagination,
} from '../src/domain.js'
import { OdooApiError } from '../src/errors.js'

const FIELDS = new Set(['id', 'name', 'partner_id', 'state', 'amount_total'])
const TYPES = new Map<string, string>([
  ['id', 'integer'],
  ['name', 'char'],
  ['partner_id', 'many2one'],
  ['state', 'selection'],
  ['image_1920', 'binary'],
  ['signature', 'binary'],
])

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
    try {
      validateDomain([['name', 'ilike', 'super-secret-customer']], new Set(['id']))
      throw new Error('expected a throw')
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-customer')
    }
  })
})

describe('validateFields', () => {
  it('falls back to the model default field set', () => {
    expect(validateFields(undefined, 'sale.order', TYPES)).toContain('id')
  })

  it('rejects a field the model does not define', () => {
    expect(() => validateFields(['nope'], 'sale.order', TYPES)).toThrowError(/nope/)
  })

  it('lists available fields in the error message and caps it at 200 characters', () => {
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/domain.test.ts`
Expected: FAIL — `Cannot find module '../src/domain.js'`

- [ ] **Step 3: 實作 `src/domain.ts`**

**arity 用遞迴下降解析**（spec §5.4）。`parseNode` 回傳「下一個未消耗的索引」：

```ts
const FIELD_PATTERN = /^[a-z_][a-z0-9_]*$/

const OPERATORS: ReadonlySet<string> = new Set([
  '=', '!=', '>', '>=', '<', '<=',
  'like', 'not like', 'ilike', 'not ilike',
  'in', 'not in', 'child_of', 'parent_of', '=like', '=ilike',
])

interface ParseState {
  readonly domain: readonly unknown[]
  readonly knownFields: ReadonlySet<string>
  leaves: number
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
export function validateDomain(domain: unknown, knownFields: ReadonlySet<string>): JsonValue[] {
  if (!Array.isArray(domain)) throw inputError('domain must be an array.')
  if (domain.length > MAX_DOMAIN_LENGTH) {
    throw inputError(`domain must contain at most ${MAX_DOMAIN_LENGTH} elements.`)
  }
  const state: ParseState = { domain, knownFields, leaves: 0 }
  let index = 0
  while (index < domain.length) index = parseNode(state, index)
  if (state.leaves > MAX_DOMAIN_LEAVES) {
    throw inputError(`domain must contain at most ${MAX_DOMAIN_LEAVES} leaves.`)
  }
  return domain as JsonValue[]
}
```

`assertLeaf(state, node, index)` 依序檢查（每一項失敗都 `inputError`，訊息**只帶規則與索引，不帶 value**）：
1. `Array.isArray(node) && node.length === 3`，否則 `` `domain element at index ${index} must be a triple.` ``
2. `typeof field === 'string'`；含 `.` → `` `domain field at index ${index} must not contain a dot; query the related model first and filter with ('field_id','in',[ids]).` ``
3. `FIELD_PATTERN.test(field)`；`knownFields.has(field)` 否 → `` `domain field ${field} does not exist on this model.` ``（欄位名是 agent 自己給的，可以回顯）
4. `OPERATORS.has(operator)`
5. value：`string`（≤ `MAX_VALUE_LENGTH`）/ `number` / `boolean` / `null`，或元素為前述型別的陣列（≤ `MAX_IN_VALUES`）。其他（物件、巢狀陣列）→ 拒絕
6. `state.leaves += 1`

`validateFields(fields, model, fieldTypes)`：
- `fields === undefined` → 回 `DEFAULT_FIELDS[model]`
- 長度必須 1..`MAX_FIELDS`（30）
- 每個欄位：`FIELD_PATTERN`、不得含 `.`
- `BINARY_FIELDS.has(field)` → `` `field ${field} is a binary field and cannot be requested.` ``
- `fieldTypes.get(field) === 'binary'` → 同上訊息
- `!fieldTypes.has(field)` → `` `field ${field} does not exist on ${model}. Available fields: ${truncateDetail([...fieldTypes.keys()].join(', '))}` ``
  （**只套 200 字元截斷，不套 redaction**——這串是本插件產生的欄位名清單，
  redaction 的 `[A-Za-z0-9_-]{20,}` 規則會誤傷長欄位名）

`validateOrder(order, knownFields)`：`undefined` → `undefined`；以 `,` 切開，最多 `MAX_ORDER_TERMS`（3）段；
每段 `trim()` 後以空白切成 `[field]` 或 `[field, direction]`；`field` 同樣禁點號 + 必須在 `knownFields`；
`direction` 若存在必須是 `asc` 或 `desc`（不分大小寫）。回傳正規化後的字串。

`validatePagination(limit, offset, defaultLimit)`：
```ts
const resolvedLimit = limit ?? defaultLimit
const resolvedOffset = offset ?? 0
// 兩者都要 Number.isSafeInteger
// 1 <= resolvedLimit <= MAX_LIMIT
// 0 <= resolvedOffset <= MAX_OFFSET
// resolvedOffset + resolvedLimit <= MAX_SEARCH_RESULTS  → 否則 inputError
```

`validateCreateValues(model, values)`：
1. `values` 必須是非 array 的物件
2. `FORBIDDEN_CREATE_FIELDS[model]` 任一 key 出現在 `values` →
   `` `values must not include ${field}; drafts always use the default state.` ``
3. 每個 key 必須在 `CREATE_FIELDS[model]`，否則 `` `values field ${key} is not allowed for ${model}.` ``
4. 依 `FieldRule.kind` 驗型別：`int`（safe integer ≥ 1）、`string`（≤ `maxLength`，trim 後非空）、
   `date`（`/^\d{4}-\d{2}-\d{2}$/`）、`intArray`（元素皆 safe integer ≥ 1，長度 ≤ `maxItems`）
5. `required` 的欄位缺漏 → `` `values must include ${field}.` ``
6. `intArray` 轉成 `[[6, 0, ids]]`
7. `model === 'sale.order'` → 回傳物件補上 `state: 'draft'`；`project.task` **不補任何 state**

**Biome 提醒**：`assertLeaf` 與 `validateCreateValues` 都容易超過 cognitive complexity 10，
把「值型別檢查」抽成 `assertScalar(value, name)` / `assertRuleValue(rule, key, value)` 兩個小函式。

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/domain.test.ts`
Expected: PASS（全部 case）

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: validate domains, fields, order, pagination, and draft values"
```

---

## Task 6: `rpc.ts` — JSON-RPC 傳輸層

**Files:**
- Create: `src/rpc.ts`, `tests/rpc.test.ts`

**Interfaces:**
- Consumes: `createHttpError` / `createRpcError` / `OdooApiError` from `src/errors.js`
- Produces:
  - `type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>`
  - `interface RpcParams { service: 'common' | 'object'; method: string; args: readonly JsonValue[] }`
  - `interface RpcTransportOptions { baseUrl: string; apiKey: string; requestTimeoutMs: number; maxResponseBytes: number; fetchImplementation?: FetchImplementation }`
  - `class RpcTransport`：`constructor(options: RpcTransportOptions)`、`call(params: RpcParams, signal?: AbortSignal, maxResponseBytesOverride?: number): Promise<JsonValue>`（回傳 JSON-RPC 的 `result`）

- [ ] **Step 1: 寫失敗測試 `tests/rpc.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'

import { OdooApiError } from '../src/errors.js'
import { RpcTransport } from '../src/rpc.js'

const OPTIONS = {
  baseUrl: 'https://odoo.example.com/',
  apiKey: 'secret-key',
  requestTimeoutMs: 1_000,
  maxResponseBytes: 10_000,
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

const transportWith = (fetchImplementation: () => Promise<Response>) =>
  new RpcTransport({ ...OPTIONS, fetchImplementation })

const VERSION = { service: 'common', method: 'version', args: [] } as const

describe('successful calls', () => {
  it('posts JSON-RPC 2.0 to the jsonrpc endpoint and returns result', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json({ jsonrpc: '2.0', id: 1, result: { a: 1 } })))
    const transport = new RpcTransport({ ...OPTIONS, fetchImplementation: fetchMock })

    await expect(transport.call(VERSION)).resolves.toEqual({ a: 1 })

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://odoo.example.com/jsonrpc')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(JSON.parse(String(init.body))).toMatchObject({
      jsonrpc: '2.0',
      method: 'call',
      params: { service: 'common', method: 'version', args: [] },
    })
  })

  it('increments the request id on every call', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json({ jsonrpc: '2.0', id: 1, result: true })))
    const transport = new RpcTransport({ ...OPTIONS, fetchImplementation: fetchMock })

    await transport.call(VERSION)
    await transport.call(VERSION)

    const ids = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).id)
    expect(ids[1]).toBe((ids[0] as number) + 1)
  })
})

describe('JSON-RPC level errors', () => {
  it('throws even though the HTTP status is 200', async () => {
    const transport = transportWith(() =>
      Promise.resolve(
        json({
          jsonrpc: '2.0',
          id: 1,
          error: { code: 200, message: 'Odoo Server Error', data: { name: 'builtins.ValueError', message: "Invalid field 'x'" } },
        }),
      ),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({
      code: 'ODOO_QUERY_ERROR',
      detail: expect.stringContaining('Invalid field'),
    })
  })
})

describe('transport probing', () => {
  it.each([
    ['404', () => Promise.resolve(new Response('nope', { status: 404 }))],
    ['405', () => Promise.resolve(new Response('nope', { status: 405 }))],
    ['302', () => Promise.resolve(new Response('', { status: 302, headers: { Location: '/web/login' } }))],
    ['html', () => Promise.resolve(new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }))],
    ['not json-rpc', () => Promise.resolve(json({ hello: 'world' }))],
  ])('maps a %s response to TRANSPORT_UNSUPPORTED', async (_label, fetchImplementation) => {
    await expect(transportWith(fetchImplementation).call(VERSION)).rejects.toMatchObject({
      code: 'TRANSPORT_UNSUPPORTED',
    })
  })
})

describe('HTTP level errors', () => {
  it.each([
    [401, 'AUTHENTICATION_FAILED'],
    [403, 'PERMISSION_DENIED'],
    [500, 'SERVER_ERROR'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const transport = transportWith(() => Promise.resolve(new Response('x', { status })))

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code })
  })

  it('keeps the Retry-After header on 429', async () => {
    const transport = transportWith(() =>
      Promise.resolve(new Response('x', { status: 429, headers: { 'Retry-After': '42' } })),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfter: '42',
    })
  })

  it('never leaks the api key through a response header', async () => {
    const transport = transportWith(() =>
      Promise.resolve(new Response('x', { status: 429, headers: { 'Retry-After': 'secret-key' } })),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({ retryAfter: undefined })
  })
})

describe('response size limits', () => {
  it('rejects when content-length exceeds the cap', async () => {
    const transport = transportWith(() =>
      Promise.resolve(
        new Response('{}', {
          headers: { 'Content-Type': 'application/json', 'Content-Length': '20000' },
        }),
      ),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('rejects when the streamed body exceeds the cap', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'y'.repeat(20_000) })
    const transport = transportWith(() =>
      Promise.resolve(new Response(big, { headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('honours a per-call override of the byte cap', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'y'.repeat(20_000) })
    const transport = transportWith(() =>
      Promise.resolve(new Response(big, { headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(transport.call(VERSION, undefined, 100_000)).resolves.toBeTypeOf('string')
  })
})

describe('invalid responses', () => {
  it('rejects malformed JSON', async () => {
    const transport = transportWith(() =>
      Promise.resolve(new Response('{oops', { headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})

describe('cancellation', () => {
  it('maps a caller abort to REQUEST_ABORTED', async () => {
    const controller = new AbortController()
    const transport = transportWith(
      () =>
        new Promise<Response>((_resolve, reject) => {
          controller.abort()
          reject(new DOMException('aborted', 'AbortError'))
        }),
    )

    await expect(transport.call(VERSION, controller.signal)).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
    })
  })

  it('maps a timeout to REQUEST_TIMEOUT', async () => {
    const transport = new RpcTransport({
      ...OPTIONS,
      requestTimeoutMs: 1,
      fetchImplementation: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    })

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
  })

  it('maps a network failure to NETWORK_ERROR', async () => {
    const transport = transportWith(() => Promise.reject(new TypeError('fetch failed')))

    await expect(transport.call(VERSION)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})

describe('error type', () => {
  it('always throws OdooApiError', async () => {
    const transport = transportWith(() => Promise.resolve(new Response('x', { status: 500 })))

    await expect(transport.call(VERSION)).rejects.toBeInstanceOf(OdooApiError)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/rpc.test.ts`
Expected: FAIL — `Cannot find module '../src/rpc.js'`

- [ ] **Step 3: 實作 `src/rpc.ts`**

`createRequestContext` / `normalizeRequestError` / `readBoundedBody` / `safeHeader` **直接抄
dsh-sonarqube `client.ts` 的同名函式**（把訊息裡的 `SonarQube` 換成 `Odoo`）。`call()` 的流程：

1. `const url = new URL('jsonrpc', this.#baseUrl)`
2. `fetch(url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: this.#nextId(), params }), signal })`
   —— **注意：apiKey 走 body 的 args，不放 Authorization header**
3. `status >= 300 && status < 400` → `TRANSPORT_UNSUPPORTED`（redirect）
4. `status === 404 || status === 405` → `TRANSPORT_UNSUPPORTED`
5. `!response.ok` → `createHttpError(status, { retryAfter: safeHeader(...), detail: status === 400 ? await readErrorDetail(response) : undefined })`
6. content-type 非 JSON → `TRANSPORT_UNSUPPORTED`（**不是 `INVALID_RESPONSE`**——這代表 endpoint 被攔截）
7. `readBoundedBody(response, maxResponseBytesOverride ?? this.#maxResponseBytes)`
8. `JSON.parse` 失敗 → `INVALID_RESPONSE`
9. body 有 `error` → `throw createRpcError(body.error, this.#apiKey)`
10. body 沒有 `result` 也沒有 `error` → `TRANSPORT_UNSUPPORTED`
11. 回傳 `body.result`

`readErrorDetail(response)`：讀 bounded body → 嘗試 `JSON.parse` → 取 `error.data.message` 或 `error.message`
→ `sanitizeDetail(value, this.#apiKey)`；任何一步失敗回 `undefined`。

**Biome 提醒**：`call()` 會超過 complexity 10——把「回應分類」抽成 `#classifyResponse(response)`、
「body 解析」抽成 `#readResult(response, cap)`。

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/rpc.test.ts`
Expected: PASS

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: add JSON-RPC transport with bounded bodies and probe detection"
```

---

## Task 7: `client.ts` — handshake 與 `odoo_server_info` 的資料來源

**Files:**
- Create: `src/client.ts`, `tests/client.test.ts`

**Interfaces:**
- Consumes: `ResolvedOdooConfig` / `assertCredentials` from `src/config.js`；`RpcTransport` / `FetchImplementation` from `src/rpc.js`；`OdooApiError` from `src/errors.js`
- Produces:
  - `class OdooClient`：`constructor(config: ResolvedOdooConfig, fetchImplementation?: FetchImplementation)`、`serverInfo(signal?: AbortSignal): Promise<ApiResult<JsonObject>>`
  - `function createOdooClient(config?: OdooConfig, env?: NodeJS.ProcessEnv, fetchImplementation?: FetchImplementation): OdooClient`
  - 內部（後續 Task 使用）：`#execute(model, method, args, kwargs, signal)`、`#uid(signal)`

- [ ] **Step 1: 寫失敗測試 `tests/client.test.ts`（handshake 區塊）**

```ts
import { describe, expect, it, vi } from 'vitest'

import { OdooClient } from '../src/client.js'
import { resolveConfig } from '../src/config.js'

const CONFIG = resolveConfig({
  baseUrl: 'https://odoo.example.com',
  db: 'demo',
  username: 'admin',
  apiKey: 'secret-key',
  requestTimeoutMs: 1_000,
  maxResponseBytes: 100_000,
})

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

const ok = (result: unknown) => json({ jsonrpc: '2.0', id: 1, result })

/** Returns a fetch mock that answers each call from the supplied result queue. */
const queueFetch = (results: readonly unknown[]) => {
  let index = 0
  return vi.fn(() => {
    const result = results[index++]
    return Promise.resolve(ok(result))
  })
}

const VERSION = { server_version: '18.0', server_serie: '18.0', protocol_version: 1 }

describe('handshake', () => {
  it('reports server version and uid', async () => {
    const fetchMock = queueFetch([VERSION, 7])
    const client = new OdooClient(CONFIG, fetchMock)

    const result = await client.serverInfo()

    expect(result.data).toMatchObject({ serverVersion: '18.0', uid: 7, db: 'demo' })
    expect(result.meta.odooVersion).toBe('18.0')
  })

  it('never exposes the api key in the payload', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7]))

    const result = await client.serverInfo()

    expect(JSON.stringify(result)).not.toContain('secret-key')
  })

  it('authenticates only once across calls', async () => {
    const fetchMock = queueFetch([VERSION, 7])
    const client = new OdooClient(CONFIG, fetchMock)

    await client.serverInfo()
    await client.serverInfo()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries the handshake after a failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(ok(VERSION))
      .mockResolvedValueOnce(ok(7))
    const client = new OdooClient(CONFIG, fetchMock)

    await expect(client.serverInfo()).rejects.toMatchObject({ code: 'SERVER_ERROR' })
    await expect(client.serverInfo()).resolves.toMatchObject({ data: { uid: 7 } })
  })

  it('maps a false authenticate result to AUTHENTICATION_FAILED', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, false]))

    await expect(client.serverInfo()).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
  })

  it('fails with INVALID_CONFIG when credentials are missing', async () => {
    const client = new OdooClient(resolveConfig({}, {}), vi.fn())

    await expect(client.serverInfo()).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })
})

describe('company validation', () => {
  const withCompany = resolveConfig({ ...CONFIG, companyId: 2 })

  it('accepts a company the user is allowed to use', async () => {
    const client = new OdooClient(withCompany, queueFetch([VERSION, 7, [{ id: 7, company_ids: [1, 2] }]]))

    await expect(client.serverInfo()).resolves.toMatchObject({ data: { companyId: 2 } })
  })

  it('rejects a company outside the user allow list', async () => {
    const client = new OdooClient(withCompany, queueFetch([VERSION, 7, [{ id: 7, company_ids: [1] }]]))

    await expect(client.serverInfo()).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })

  it('skips the company check when companyId is unset', async () => {
    const fetchMock = queueFetch([VERSION, 7])
    await new OdooClient(CONFIG, fetchMock).serverInfo()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/client.test.ts`
Expected: FAIL — `Cannot find module '../src/client.js'`

- [ ] **Step 3: 實作 `src/client.ts` 的 handshake 部分**

```ts
interface Handshake {
  readonly uid: number
  readonly version: JsonObject
}

export class OdooClient {
  readonly #config: ResolvedOdooConfig
  readonly #transport: RpcTransport
  readonly #fieldTypes = new Map<string, ReadonlyMap<string, string>>()
  #handshake: Promise<Handshake> | undefined

  constructor(config: ResolvedOdooConfig, fetchImplementation: FetchImplementation = fetch) {
    this.#config = config
    this.#transport = new RpcTransport({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      requestTimeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      fetchImplementation,
    })
  }

  /** Returns the Odoo server version and the authenticated user id. */
  async serverInfo(signal?: AbortSignal): Promise<ApiResult<JsonObject>> {
    const handshake = await this.#connect(signal)
    return {
      data: {
        serverVersion: stringOr(handshake.version.server_version, 'unknown'),
        serverSerie: stringOr(handshake.version.server_serie, 'unknown'),
        protocolVersion: numberOr(handshake.version.protocol_version, 0),
        uid: handshake.uid,
        db: this.#config.db,
        ...(this.#config.companyId === undefined ? {} : { companyId: this.#config.companyId }),
      },
      meta: { odooVersion: stringOr(handshake.version.server_version, 'unknown') },
    }
  }

  #connect(signal?: AbortSignal): Promise<Handshake> {
    this.#handshake ??= this.#performHandshake(signal).catch((error: unknown) => {
      this.#handshake = undefined
      throw error
    })
    return this.#handshake
  }
}
```

`#performHandshake(signal)` 三步（spec §2.4）：
1. `assertCredentials(this.#config)`
2. `const version = await this.#transport.call({ service: 'common', method: 'version', args: [] }, signal)`
   —— 非物件 → `INVALID_RESPONSE`
3. `const uid = await this.#transport.call({ service: 'common', method: 'authenticate', args: [db, username, apiKey, {}] }, signal)`
   —— `uid` 不是正整數（Odoo 失敗時回 `false`）→
   `new OdooApiError('Odoo rejected the credentials. Check db, username, and apiKey.', { code: 'AUTHENTICATION_FAILED' })`
4. `companyId !== undefined` 時：
   `execute_kw('res.users', 'read', [[uid], ['company_ids']])` → 取 `[0].company_ids`；
   不含 `companyId` → `configError('The configured companyId is not among the authenticated user allowed companies.')`

`#execute(model, method, args, kwargs, signal)`（後續 Task 共用）：
```ts
async #execute(
  model: string,
  method: string,
  args: readonly JsonValue[],
  kwargs: JsonObject,
  signal?: AbortSignal,
  maxResponseBytesOverride?: number,
): Promise<JsonValue> {
  const { uid } = await this.#connect(signal)
  return this.#transport.call(
    {
      service: 'object',
      method: 'execute_kw',
      args: [this.#config.db, uid, this.#config.apiKey, model, method, args, this.#withContext(kwargs)],
    },
    signal,
    maxResponseBytesOverride,
  )
}
```
`#withContext(kwargs)`：`companyId` 有設定時併入 `context: { allowed_company_ids: [companyId] }`。

`createOdooClient(config, env, fetchImplementation)` 比照 dsh-sonarqube 的 `createSonarQubeClient`：
`new OdooClient(resolveConfig(config, env), fetchImplementation)`。

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/client.test.ts`
Expected: PASS

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: add Odoo client handshake with uid and company validation"
```

---

## Task 8: `client.ts` — 欄位型別快取與 `describeModel`

**Files:**
- Modify: `src/client.ts`
- Modify: `tests/client.test.ts`（追加 describe 區塊）

**Interfaces:**
- Consumes: Task 7 的 `#execute`；`isReadModel` / `MAX_DESCRIBE_FIELDS` / `MAX_SELECTION_OPTIONS` from `src/models.js`
- Produces: `OdooClient.describeModel(model: string, signal?: AbortSignal): Promise<ApiResult<JsonObject>>`；內部 `#fieldTypesFor(model, signal): Promise<ReadonlyMap<string, string>>`

- [ ] **Step 1: 追加失敗測試到 `tests/client.test.ts`**

```ts
const FIELDS_GET = {
  id: { string: 'ID', type: 'integer' },
  name: { string: 'Name', type: 'char' },
  image_1920: { string: 'Image', type: 'binary' },
  signature: { string: 'Signature', type: 'binary' },
  state: {
    string: 'Status',
    type: 'selection',
    selection: [
      ['draft', 'Quotation'],
      ['sale', 'Sales Order'],
    ],
  },
}

describe('describeModel', () => {
  it('returns trimmed field metadata', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET]))

    const result = await client.describeModel('sale.order')

    expect(result.meta.model).toBe('sale.order')
    expect(Object.keys(result.data as object)).toEqual(['id', 'name', 'state'])
    expect(result.data).toMatchObject({ name: { string: 'Name', type: 'char' } })
  })

  it('drops binary fields entirely', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET]))

    const result = await client.describeModel('sale.order')

    expect(result.data).not.toHaveProperty('image_1920')
    expect(result.data).not.toHaveProperty('signature')
  })

  it('rejects a model outside the allow list', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7]))

    await expect(client.describeModel('ir.attachment')).rejects.toMatchObject({
      code: 'MODEL_NOT_ALLOWED',
    })
  })

  it('calls fields_get only once per model', async () => {
    const fetchMock = queueFetch([VERSION, 7, FIELDS_GET])
    const client = new OdooClient(CONFIG, fetchMock)

    await client.describeModel('sale.order')
    await client.describeModel('sale.order')

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('truncates a long selection list', async () => {
    const selection = Array.from({ length: 40 }, (_, index) => [`s${index}`, `S${index}`])
    const client = new OdooClient(
      CONFIG,
      queueFetch([VERSION, 7, { state: { string: 'Status', type: 'selection', selection } }]),
    )

    const result = await client.describeModel('sale.order')

    expect(result.meta.truncatedFields).toEqual(['state'])
  })

  it('caps the field count at two hundred', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => [`f${index}`, { string: 'F', type: 'char' }]),
    )
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, many]))

    const result = await client.describeModel('sale.order')

    expect(result.meta.truncated).toBe(true)
    expect(result.meta.returned).toBe(200)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/client.test.ts`
Expected: FAIL — `client.describeModel is not a function`

- [ ] **Step 3: 實作 `describeModel` 與型別快取**

```ts
/** Loads and caches the field name to type map for one allow-listed model. */
async #fieldTypesFor(model: ReadModel, signal?: AbortSignal): Promise<ReadonlyMap<string, string>> {
  const cached = this.#fieldTypes.get(model)
  if (cached !== undefined) return cached
  const raw = await this.#fieldsGet(model, signal)
  const types = new Map<string, string>()
  for (const [name, meta] of Object.entries(raw)) {
    types.set(name, stringOr(isJsonObject(meta) ? meta.type : undefined, 'unknown'))
  }
  this.#fieldTypes.set(model, types)
  return types
}
```

`#fieldsGet(model, signal)`：
```ts
this.#execute(
  model,
  'fields_get',
  [[]],
  { attributes: ['string', 'type', 'relation', 'selection', 'required', 'readonly'] },
  signal,
)
```
**同時把原始結果快取起來**（`#fieldsRaw: Map<string, JsonObject>`），讓 `describeModel` 與 `#fieldTypesFor`
共用一次 RPC——這正是測試 `calls fields_get only once per model` 要驗的。

`describeModel(model, signal)`：
1. `isReadModel(model)` 否 → `new OdooApiError('This model is not on the read allow list.', { code: 'MODEL_NOT_ALLOWED', model })`
2. 取原始 `fields_get`
3. 逐欄位裁剪：`type === 'binary'` 直接跳過；只保留 6 個 attribute；
   `selection` 陣列長度 > `MAX_SELECTION_OPTIONS` 時截斷並把欄位名推進 `truncatedFields`
4. 欄位依名稱字典序排序，超過 `MAX_DESCRIBE_FIELDS` 取前 200 並設 `meta.truncated = true`
5. 回 `{ data: trimmed, meta: { model, returned, ...(truncated && { truncated: true }), ...(truncatedFields.length > 0 && { truncatedFields }) } }`

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/client.test.ts`
Expected: PASS

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: describe allow-listed models with a shared field type cache"
```

---

## Task 9: `client.ts` — `searchRead` 與回應裁剪

**Files:**
- Modify: `src/client.ts`
- Modify: `tests/client.test.ts`

**Interfaces:**
- Consumes: Task 8 的 `#fieldTypesFor`；`validateDomain` / `validateFields` / `validateOrder` / `validatePagination` from `src/domain.js`；`MAX_STRING_CHARS` from `src/models.js`
- Produces: `OdooClient.searchRead(params: SearchReadParams, signal?: AbortSignal): Promise<ApiResult<JsonValue>>`

- [ ] **Step 1: 追加失敗測試到 `tests/client.test.ts`**

```ts
describe('searchRead', () => {
  const records = [{ id: 1, name: 'ACME', partner_id: [4, 'ACME Inc'] }]

  it('sends the model default fields when none are given', async () => {
    const fetchMock = queueFetch([VERSION, 7, FIELDS_GET, 1, records])
    const client = new OdooClient(CONFIG, fetchMock)

    await client.searchRead({ model: 'sale.order' })

    const body = JSON.parse(String((fetchMock.mock.calls[4]?.[1] as RequestInit).body))
    expect(body.params.args[4]).toBe('search_read')
    expect(body.params.args[6].fields).toContain('id')
  })

  it('returns total, returned, and offset in meta', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET, 137, records]))

    const result = await client.searchRead({ model: 'sale.order', fields: ['id', 'name'] })

    expect(result.meta).toMatchObject({ model: 'sale.order', total: 137, returned: 1, offset: 0 })
  })

  it('truncates long string values and reports the field', async () => {
    const long = [{ id: 1, name: 'x'.repeat(2_500) }]
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET, 1, long]))

    const result = await client.searchRead({ model: 'sale.order', fields: ['id', 'name'] })
    const record = (result.data as { name: string }[])[0]

    expect(record?.name.endsWith('[truncated]')).toBe(true)
    expect(result.meta.truncatedFields).toEqual(['name'])
  })

  it('keeps many2one values in the native pair shape', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET, 1, records]))

    const result = await client.searchRead({ model: 'sale.order', fields: ['id', 'partner_id'] })

    expect((result.data as { partner_id: unknown }[])[0]?.partner_id).toEqual([4, 'ACME Inc'])
  })

  it('rejects a model outside the allow list', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7]))

    await expect(client.searchRead({ model: 'ir.attachment' })).rejects.toMatchObject({
      code: 'MODEL_NOT_ALLOWED',
    })
  })

  it('rejects an unknown field with the available field list', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET]))

    await expect(
      client.searchRead({ model: 'sale.order', fields: ['nope'] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects a binary field that is not on the fast-path list', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET]))

    await expect(
      client.searchRead({ model: 'sale.order', fields: ['signature'] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects a dotted domain field', async () => {
    const client = new OdooClient(CONFIG, queueFetch([VERSION, 7, FIELDS_GET]))

    await expect(
      client.searchRead({ model: 'sale.order', domain: [['partner_id.name', '=', 'x']] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('passes allowed_company_ids in the context when configured', async () => {
    const fetchMock = queueFetch([VERSION, 7, [{ id: 7, company_ids: [1, 2] }], FIELDS_GET, 1, records])
    const client = new OdooClient(resolveConfig({ ...CONFIG, companyId: 2 }), fetchMock)

    await client.searchRead({ model: 'sale.order', fields: ['id'] })

    const body = JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body))
    expect(body.params.args[6].context).toEqual({ allowed_company_ids: [2] })
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/client.test.ts`
Expected: FAIL — `client.searchRead is not a function`

- [ ] **Step 3: 實作 `searchRead`**

流程：
1. `isReadModel(params.model)` 否 → `MODEL_NOT_ALLOWED`
2. `const types = await this.#fieldTypesFor(model, signal)`；`const known = new Set(types.keys())`
3. `const domain = validateDomain(params.domain ?? [], known)`
4. `const fields = validateFields(params.fields, model, types)`
5. `const order = validateOrder(params.order, known)`
6. `const { limit, offset } = validatePagination(params.limit, params.offset, this.#config.defaultLimit)`
7. `const total = await this.#execute(model, 'search_count', [domain], {}, signal)`
8. `const rows = await this.#execute(model, 'search_read', [domain], { fields, limit, offset, ...(order && { order }) }, signal)`
9. 裁剪：`trimRecords(rows)` — 遞迴走訪每筆記錄的**第一層值**（Odoo 的 search_read 只回純量與
   many2one pair），`typeof value === 'string' && value.length > MAX_STRING_CHARS` 時
   `` `${value.slice(0, MAX_STRING_CHARS)}…[truncated]` `` 並記錄欄位名（去重、保持欄位順序）
10. 回 `{ data: trimmed, meta: { model, total, returned: trimmed.length, offset, ...(truncatedFields.length > 0 && { truncatedFields }) } }`

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/client.test.ts`
Expected: PASS

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: add restricted search_read with response trimming"
```

---

## Task 10: `client.ts` — `createDraft` 與 `WRITE_DISABLED` 防線

**Files:**
- Modify: `src/client.ts`
- Modify: `tests/client.test.ts`

**Interfaces:**
- Consumes: `validateCreateValues` from `src/domain.js`；`isWriteModel` / `CREATE_READBACK_FIELDS` from `src/models.js`
- Produces: `OdooClient.createDraft(params: CreateDraftParams, signal?: AbortSignal): Promise<ApiResult<JsonObject>>`

- [ ] **Step 1: 追加失敗測試到 `tests/client.test.ts`**

```ts
describe('createDraft', () => {
  const WRITABLE = resolveConfig({ ...CONFIG, allowWrite: true })

  it('creates a draft sale order and reads it back', async () => {
    const fetchMock = queueFetch([VERSION, 7, 42, [{ id: 42, name: 'S0001', state: 'draft' }]])
    const client = new OdooClient(WRITABLE, fetchMock)

    const result = await client.createDraft({ model: 'sale.order', values: { partner_id: 3 } })

    expect(result.data).toMatchObject({ id: 42, state: 'draft' })
    expect(result.meta.model).toBe('sale.order')

    const createBody = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))
    expect(createBody.params.args[4]).toBe('create')
    expect(createBody.params.args[5][0]).toEqual({ partner_id: 3, state: 'draft' })
  })

  it('creates a project task without any state or stage', async () => {
    const fetchMock = queueFetch([VERSION, 7, 9, [{ id: 9, name: 'Task', stage_id: [1, 'New'] }]])
    const client = new OdooClient(WRITABLE, fetchMock)

    await client.createDraft({ model: 'project.task', values: { name: 'Task', project_id: 5 } })

    const createBody = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))
    expect(createBody.params.args[5][0]).toEqual({ name: 'Task', project_id: 5 })
  })

  it('rejects a model outside the write allow list', async () => {
    const client = new OdooClient(WRITABLE, queueFetch([VERSION, 7]))

    await expect(
      client.createDraft({ model: 'res.partner', values: { name: 'x' } }),
    ).rejects.toMatchObject({ code: 'MODEL_NOT_ALLOWED' })
  })

  it('refuses to write when allowWrite is false', async () => {
    const fetchMock = vi.fn()
    const client = new OdooClient(CONFIG, fetchMock)

    await expect(
      client.createDraft({ model: 'sale.order', values: { partner_id: 3 } }),
    ).rejects.toMatchObject({ code: 'WRITE_DISABLED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces an Odoo UserError with its sanitized detail', async () => {
    const client = new OdooClient(
      WRITABLE,
      vi
        .fn()
        .mockResolvedValueOnce(ok(VERSION))
        .mockResolvedValueOnce(ok(7))
        .mockResolvedValueOnce(
          json({
            jsonrpc: '2.0',
            id: 3,
            error: {
              code: 200,
              message: 'Odoo Server Error',
              data: { name: 'odoo.exceptions.UserError', message: 'Please define a pricelist.' },
            },
          }),
        ),
    )

    await expect(
      client.createDraft({ model: 'sale.order', values: { partner_id: 3 } }),
    ).rejects.toMatchObject({
      code: 'ODOO_VALIDATION_ERROR',
      detail: 'Please define a pricelist.',
    })
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/client.test.ts`
Expected: FAIL — `client.createDraft is not a function`

- [ ] **Step 3: 實作 `createDraft`**

```ts
/** Creates one draft record on an allow-listed write model. */
async createDraft(params: CreateDraftParams, signal?: AbortSignal): Promise<ApiResult<JsonObject>> {
  if (!this.#config.allowWrite) {
    throw new OdooApiError('Draft creation is disabled. Set allowWrite to true to enable it.', {
      code: 'WRITE_DISABLED',
    })
  }
  if (!isWriteModel(params.model)) {
    throw new OdooApiError('This model is not on the draft-create allow list.', {
      code: 'MODEL_NOT_ALLOWED',
      model: params.model,
    })
  }
  const values = validateCreateValues(params.model, params.values)
  const id = await this.#execute(params.model, 'create', [[values]], {}, signal)
  if (!Number.isSafeInteger(id) || (id as number) < 1) {
    throw new OdooApiError('Odoo returned an unexpected create result.', {
      code: 'INVALID_RESPONSE',
      model: params.model,
    })
  }
  const rows = await this.#execute(
    params.model,
    'read',
    [[id], CREATE_READBACK_FIELDS[params.model]],
    {},
    signal,
  )
  const record = Array.isArray(rows) ? rows[0] : undefined
  if (!isJsonObject(record)) {
    throw new OdooApiError('Odoo returned an unexpected read result.', {
      code: 'INVALID_RESPONSE',
      model: params.model,
    })
  }
  return { data: record, meta: { model: params.model } }
}
```

注意順序：**`WRITE_DISABLED` 必須在任何 RPC 之前**（測試斷言 `fetchMock` 完全沒被呼叫）。
`create` 的 args 用 `[[values]]`（Odoo 的 `create` 收 list）；`id` 不是正整數 → `INVALID_RESPONSE`。
讀回用 `this.#execute(model, 'read', [[id], CREATE_READBACK_FIELDS[model]], {}, signal)`，取第一筆當 `data`。
`meta` 只放 `{ model }`。

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/client.test.ts`
Expected: PASS

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: add opt-in draft creation with a write-disabled guard"
```

---

## Task 11: `locales.ts` — 四語文案（G1）

**Files:**
- Create: `src/locales.ts`, `tests/locales.test.ts`

**Interfaces:**
- Consumes: `Locale` from `src/config.js`
- Produces:
  - `interface OdooMessages`：`serverInfoDescription`、`describeModelDescription`、`searchReadDescription`、`createDraftDescription`、`createDraftTitle`、`modelParam`、`describeModelParam`、`domainParam`、`fieldsParam`、`limitParam`、`offsetParam`、`orderParam`、`writeModelParam`、`valuesParam`
  - `const MESSAGES: Readonly<Record<Locale, OdooMessages>>`
  - `function odooMessages(locale: Locale): OdooMessages`
  - `const CONFIG_I18N`（key：`en` / `en-US` / `zh` / `zh-CN` / `zh-TW` / `ja` / `ja-JP`）

- [ ] **Step 1: 寫失敗測試 `tests/locales.test.ts`**

```ts
import { describe, expect, it } from 'vitest'

import { LOCALES } from '../src/config.js'
import { CONFIG_I18N, MESSAGES, odooMessages } from '../src/locales.js'

describe('tool metadata locales', () => {
  it('covers every supported locale', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...LOCALES].sort())
  })

  it('never leaves a message blank', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(MESSAGES[locale])) {
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/locales.test.ts`
Expected: FAIL — `Cannot find module '../src/locales.js'`

- [ ] **Step 3: 實作 `src/locales.ts`**

`CONFIG_I18N` 的結構直接抄 dsh-sonarqube 的 `locales.ts`（`ConfigLocaleMessages` interface +
四個 `as const satisfies` 常數 + 7 個 key 的匯出物件），欄位換成本插件的 10 個 config 欄位。

`MESSAGES` 的英文版（其他三語照譯，**必須保留同樣的關鍵字**：`sale.order`、`project.task`、`state`、
`stage_id`、`in`）：

```ts
const ENGLISH: OdooMessages = {
  serverInfoDescription: 'Read the connected Odoo server version and the authenticated user id.',
  describeModelDescription:
    'List the queryable fields of one allow-listed Odoo model: name, type, label, relation, and selection values. Call this before building a domain for odoo_search_read.',
  searchReadDescription:
    "Run a restricted search_read on one allow-listed Odoo model. Domain field names may not contain dots, so related-record conditions are not possible: query the related model first, then filter with ('field_id','in',[ids]). Only non-archived records are returned. When fields are omitted, a fixed default field set for that model is used.",
  createDraftDescription:
    'Create one draft record in Odoo. Only sale.order and project.task are allowed. A sale.order is always created with state=draft; a project.task may not specify state or stage_id and lands in the project first stage.',
  createDraftTitle: 'Create Odoo draft record',
  modelParam: 'Odoo model to query; only allow-listed models are accepted',
  describeModelParam: 'Odoo model to describe; only allow-listed models are accepted',
  domainParam:
    "Odoo domain as a prefix-notation array, for example [['state','=','draft']]. Field names may not contain dots",
  fieldsParam: 'Field names to return, 1-30; omit to use the default field set for the model',
  limitParam: 'Maximum records to return, 1-100',
  offsetParam: 'Records to skip; offset plus limit may not exceed 10000',
  orderParam: 'Sort clause such as "date_order desc", at most three terms',
  writeModelParam: 'Model to create a draft in: sale.order or project.task',
  valuesParam:
    'Field values for the new draft record; only allow-listed fields are accepted and state or stage_id may not be set',
}
```

`odooMessages(locale)`：`MESSAGES[locale] ?? MESSAGES.en`。

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/locales.test.ts`
Expected: PASS

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: add four-language tool and config metadata"
```

---

## Task 12: `tools.ts` — 4 個工具定義

**Files:**
- Create: `src/tools.ts`, `tests/tools.test.ts`

**Interfaces:**
- Consumes: `OdooClient` from `src/client.js`；`odooMessages` from `src/locales.js`；`READ_MODELS` / `WRITE_MODELS` from `src/models.js`；`Locale` from `src/config.js`
- Produces: `function createOdooTools(client: OdooClient, locale: Locale, allowWrite: boolean): ToolDefinition[]`

- [ ] **Step 1: 寫失敗測試 `tests/tools.test.ts`**

```ts
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'

import type { OdooClient } from '../src/client.js'
import { createOdooTools } from '../src/tools.js'
import { READ_MODELS, WRITE_MODELS } from '../src/models.js'

const stubClient = () =>
  ({
    serverInfo: vi.fn().mockResolvedValue({ data: { uid: 1 }, meta: { odooVersion: '18.0' } }),
    describeModel: vi.fn().mockResolvedValue({ data: {}, meta: { model: 'sale.order' } }),
    searchRead: vi.fn().mockResolvedValue({ data: [], meta: { model: 'sale.order', total: 0 } }),
    createDraft: vi.fn().mockResolvedValue({ data: { id: 1 }, meta: { model: 'sale.order' } }),
  }) as unknown as OdooClient

const byName = (tools: readonly ToolDefinition[], name: string) =>
  tools.find((tool) => tool.name === name)

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

    expect(tool?.parameters?.model).toMatchObject({ required: true, enum: [...READ_MODELS] })
  })

  it('restricts the draft model to the write allow list', () => {
    const tool = byName(createOdooTools(stubClient(), 'en', true), 'odoo_create_draft')

    expect(tool?.parameters?.model).toMatchObject({ required: true, enum: [...WRITE_MODELS] })
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
    const allowed = ['model', 'total', 'returned', 'offset', 'truncatedFields', 'truncated', 'odooVersion']

    expect(Object.keys(result.meta).every((key) => allowed.includes(key))).toBe(true)
  })

  it('renders the result as a single JSON text block', () => {
    const tool = byName(createOdooTools(stubClient(), 'en', false), 'odoo_server_info')
    const rendered = tool?.output?.render?.({}, { data: { uid: 1 }, meta: {} } as never)

    expect(rendered).toEqual([{ type: 'text', text: '{"data":{"uid":1},"meta":{}}' }])
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/tools.test.ts`
Expected: FAIL — `Cannot find module '../src/tools.js'`

- [ ] **Step 3: 實作 `src/tools.ts`**

```ts
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
```

四個 builder 各自照 dsh-forge 的 `defineTool` 形狀寫。參數表：

| 工具 | 參數 |
| --- | --- |
| `odoo_server_info` | 無 |
| `odoo_describe_model` | `model`（`{ type: 'string', required: true, enum: READ_MODELS, description: messages.describeModelParam }`） |
| `odoo_search_read` | `model`（同上但用 `messages.modelParam`）、`domain`（`{ type: 'array', items: { type: 'json' } }`）、`fields`（`{ type: 'array', items: { type: 'string' } }`）、`limit` / `offset`（`{ type: 'integer' }`）、`order`（`{ type: 'string' }`） |
| `odoo_create_draft` | `model`（`enum: WRITE_MODELS`、`messages.writeModelParam`）、`values`（`{ type: 'object', required: true, additionalProperties: true, description: messages.valuesParam }`） |

每個 `execute` 都是 `(args, exec) => client.xxx(args, exec.signal)` 的薄轉接，
每個工具都設 `isConcurrencySafe: () => true`，
**只有** `odoo_create_draft` 設
`presentCall: () => ({ card: 'generic', title: messages.createDraftTitle, kind: 'edit' })`。

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/tools.test.ts`
Expected: PASS

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: define the four dsh-odoo tools"
```

---

## Task 13: `index.ts` — Cordis 插件入口

**Files:**
- Create: `src/index.ts`, `tests/plugin.test.ts`

**Interfaces:**
- Consumes: 前面所有模組
- Produces: `const name = 'dsh-odoo'`、`const inject = ['tools']`、`type Config = OdooConfig`、`const Config: Schema<Config>`、`function apply(ctx: Context, config: Config): void`，以及 `OdooClient` / `createOdooClient` / `OdooApiError` / `LOCALES` / 型別的公開 re-export

- [ ] **Step 1: 寫失敗測試 `tests/plugin.test.ts`**

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `bun run test tests/plugin.test.ts`
Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 3: 實作 `src/index.ts`**

```ts
/**
 * dsh-odoo — read-only Odoo tools for DeepSeek Harness.
 * @module dsh-odoo
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

import { createOdooClient } from './client.js'
import type { OdooConfig } from './config.js'
import {
  DEFAULT_LIMIT,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  LOCALES,
  MAX_LIMIT,
  MAX_REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
} from './config.js'
import { CONFIG_I18N } from './locales.js'
import { createOdooTools } from './tools.js'

/** Stable Cordis plugin name. */
export const name = 'dsh-odoo'

/** DSH services required by this plugin. */
export const inject = ['tools']

/** Plugin configuration supplied through Cordis. */
export type Config = OdooConfig

/** Schemastery configuration exposed by the plugin. */
export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default(''),
  db: Schema.string().default(''),
  username: Schema.string().default(''),
  apiKey: Schema.string().role('secret').default(''),
  companyId: Schema.number().step(1).min(1),
  allowWrite: Schema.boolean().default(false),
  locale: Schema.union(LOCALES).default('en'),
  defaultLimit: Schema.number().step(1).min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  requestTimeoutMs: Schema.number()
    .step(1)
    .min(1)
    .max(MAX_REQUEST_TIMEOUT_MS)
    .default(DEFAULT_REQUEST_TIMEOUT_MS),
  maxResponseBytes: Schema.number()
    .step(1)
    .min(1)
    .max(MAX_RESPONSE_BYTES)
    .default(DEFAULT_MAX_RESPONSE_BYTES),
}).i18n(CONFIG_I18N)

/** Creates one client and registers every enabled tool. */
export function apply(ctx: Context, config: Config): void {
  const client = createOdooClient(config)
  for (const tool of createOdooTools(client, config.locale ?? 'en', config.allowWrite === true)) {
    ctx.tools.register(tool)
  }
}

export { createOdooClient, OdooClient } from './client.js'
export { LOCALES, type Locale, resolveConfig } from './config.js'
export type { OdooConfig, ResolvedOdooConfig } from './config.js'
export { createHttpError, OdooApiError } from './errors.js'
export { READ_MODELS, WRITE_MODELS } from './models.js'
export type * from './types.js'
```

**關鍵**：`createOdooClient(config)` 在這裡**建立一個實例並重複使用**——
不要寫成 `() => createOdooClient(config)` 的 provider function（spec §2.4；那會讓 handshake 與欄位快取失效）。

- [ ] **Step 4: 跑測試確認通過**

Run: `bun run test tests/plugin.test.ts`
Expected: PASS

- [ ] **Step 5: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "feat: register the dsh-odoo Cordis plugin entry"
```

---

## Task 14: 四語 README、CI 與 release workflow

**Files:**
- Create: `README.md`, `README.zh-TW.md`, `README.zh-CN.md`, `README.ja.md`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `scripts/smoke-odoo.sh`

**Interfaces:**
- Consumes: 前面所有 Task 的成果
- Produces: 無程式介面

- [ ] **Step 1: 寫四份 README**

每份的語言切換列放在標題下方，內容一致，只是語言不同：

```markdown
# dsh-odoo

English | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)
```

必含章節與**必須寫進去的事實**：
- **Tools 表**：4 個工具（`odoo_create_draft` 那列註明 `requires allowWrite`）
- **Transport**：本插件走 JSON-RPC，需要 Odoo 開放 `/jsonrpc`（spec §2.3）
- **Requirements**：Node 22.19+ / 24+、Bun 1.3.5+、Odoo URL + db + username + API key
- **⚠️ 尚未對真實 Odoo 做過 live 驗證**（spec §9）——這句四份都要有，等實測後再改成
  「Validated against Odoo x.y on yyyy-mm-dd」
- **Configuration 表**：10 個欄位、環境變數對應、預設值（照 spec §5.1）
- **Safety**：唯讀為主；`allowWrite` 預設 false 且關閉時工具不註冊；domain 不允許點號（要教
  「先查關聯 model 取 id，再用 `('partner_id','in',[ids])`」）；只回未封存記錄；binary 欄位一律拒絕
- **Non-goals**：照 spec §10 摘要，特別註明業務包裝工具延到 0.2

- [ ] **Step 2: 建立 `.github/workflows/ci.yml`**

複製 `~/side/ankey/dsh-sonarqube/.github/workflows/ci.yml`，改三處：
1. pack smoke test 的 `find artifacts -name 'dsh-sonarqube-*.tgz'` → `'dsh-odoo-*.tgz'`
2. `grep -q 'package/lib/locales.js'` 等檢查保留；README 四份的檢查保留
3. node-runtime job 的矩陣（`22.19.0` / `24`）與最後的 `import('./lib/index.js')` 保留不動

- [ ] **Step 3: 建立 `.github/workflows/release.yml`**

複製 `~/side/ankey/dsh-sonarqube/.github/workflows/release.yml`，把 `dsh-sonarqube` 換成 `dsh-odoo`。
**這三點不能改壞**：

```yaml
      - name: Verify tag and build tarball
        run: |
          PACKAGE_VERSION="$(node --print "require('./package.json').version")"
          test "$GITHUB_REF_NAME" = "v${PACKAGE_VERSION}"
          bun pm pack
          PACKAGE_TARBALL="dsh-odoo-${PACKAGE_VERSION}.tgz"
          tar --list --gzip --file "$PACKAGE_TARBALL"
          cp "$PACKAGE_TARBALL" dsh-odoo.tgz
          sha256sum "$PACKAGE_TARBALL" dsh-odoo.tgz >SHA256SUMS
          echo "PACKAGE_TARBALL=$PACKAGE_TARBALL" >>"$GITHUB_ENV"
      - name: Publish GitHub release
        env:
          GH_TOKEN: ${{ github.token }}
        run: >-
          gh release create "$GITHUB_REF_NAME" "$PACKAGE_TARBALL" dsh-odoo.tgz SHA256SUMS
          --verify-tag --generate-notes
```

1. **先驗 tag 與 package.json 版本一致**
2. **tarball 檔名一定要透過 `$GITHUB_ENV` 傳給下一個 step**（跨 step 的 shell 變數不保留，
   dsh-forge v0.3.2 因此掛過）
3. **穩定檔名 `dsh-odoo.tgz` 一定要附上**（讓 `releases/latest/download/dsh-odoo.tgz` 跨版本不壞）

- [ ] **Step 4: 建立 `scripts/smoke-odoo.sh`**

手動執行、不進 CI。從環境變數讀設定，依序跑
`odoo_server_info` → `odoo_describe_model res.partner` → `odoo_search_read res.partner`
→ `odoo_search_read sale.order` →（`ODOO_ALLOW_WRITE=true` 時）`odoo_create_draft`。
開頭要 `set -euo pipefail`，缺環境變數時印出用法並 `exit 1`。

- [ ] **Step 5: 本機驗證 pack 內容**

```bash
bun run build
mkdir -p artifacts && bun pm pack --destination artifacts
tar -tzf artifacts/dsh-odoo-0.1.0.tgz | grep -E 'lib/index.js|lib/locales.js|cordis.patch.yml|README.zh-TW.md|LICENSE'
rm -rf artifacts
```
Expected: 五個檔案都列得出來。

- [ ] **Step 6: 四指令驗證並 commit**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
git add -A
git commit -m "docs: add four-language READMEs, CI, and release workflow"
git push
```

---

## 完成標準

全部 14 個 Task 做完後：

- [ ] `bun run lint` / `bun run typecheck` / `bun run test` / `bun run build` 四綠
- [ ] `bun run test --coverage` 的 branches / functions / lines / statements 都 ≥ 80%
- [ ] `src/` 共 10 個檔案；`tests/` 共 10 支測試檔
- [ ] `allowWrite: false` 註冊 3 個工具、`allowWrite: true` 註冊 4 個
- [ ] `package.json` 有 `dsh.bundle.patch`；peer dep 範圍含 `|| ^0.1.1-rc.2`
- [ ] 四份 README 都標示「尚未 live 驗證」
- [ ] 全程沒有引入任何 runtime dependency（`package.json` 不該出現 `dependencies` 區塊）
