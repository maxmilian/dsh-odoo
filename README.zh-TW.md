# dsh-odoo

[English](README.md) | 繁體中文 | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

`dsh-odoo` 是一個免費、開源、以唯讀為主的 DeepSeek Harness 插件，串接 Odoo external API。
它讓 agent 能查看 Odoo 的營運資料——聯絡人、報價單、銷售訂單、發票、專案任務、商機、庫存——
而不會改動 Odoo 狀態。另有一個需明確開啟的工具可建立受嚴格限制的草稿記錄；未開啟時該工具根本不會被註冊。

> ⚠️ **尚未對真實 Odoo 伺服器做過 live 驗證。** 本版本的所有相容性假設都取自 Odoo 官方文件，
> 僅由 mock 測試覆蓋。正式倚賴前請先對你自己的實例驗證。

## 工具

| 工具 | 用途 |
| --- | --- |
| `odoo_server_info` | 讀取伺服器版本與目前登入的使用者 id。 |
| `odoo_describe_model` | 列出白名單 model 的可查詢欄位。 |
| `odoo_search_read` | 在白名單 model 上執行受限的 `search_read`。 |
| `odoo_create_draft` | 建立一筆草稿記錄。**需要 `allowWrite: true`**；否則永遠不會註冊。 |

## 傳輸方式

本插件以 **JSON-RPC 2.0** 呼叫 `POST {baseUrl}/jsonrpc`，因此你的 Odoo 必須開放該端點
（由 `web` 模組提供）。若端點不存在、被重導、或被 proxy 攔截，所有工具都會以
`TRANSPORT_UNSUPPORTED` 錯誤明確告知。本版本未實作 XML-RPC。

## 需求

- 具備相容 `@deepseek-ai/dsh-tools` API 的 DeepSeek Harness
- Node.js 22.19 以上（22.x 線）或 Node.js 24 以上
- 從 GitHub 原始碼安裝或本機開發時需 Bun 1.3.5 以上
- Odoo 網址、資料庫名稱、登入帳號與 API key（或密碼），且對要查詢的 model 有存取權

## 設定

建議使用環境變數，避免憑證出現在 profile patch 裡：

```sh
export ODOO_URL='https://odoo.example.com'
export ODOO_DB='production'
export ODOO_USERNAME='integration@example.com'
export ODOO_API_KEY='your-api-key'
```

plugin config 的優先序高於環境變數：

| Config | 環境變數 fallback | 預設值 |
| --- | --- | --- |
| `baseUrl` | `ODOO_URL` | 必填 |
| `db` | `ODOO_DB` | 必填 |
| `username` | `ODOO_USERNAME` | 必填 |
| `apiKey` | `ODOO_API_KEY` | 必填 |
| `companyId` | `ODOO_COMPANY_ID` | 未設定 |
| `allowWrite` | 無（刻意不提供） | `false` |
| `locale` | 無 | `en`（`en` / `zh-TW` / `zh-CN` / `ja`） |
| `defaultLimit` | 無 | `20`（1–100） |
| `requestTimeoutMs` | 無 | `30000`（1–300000） |
| `maxResponseBytes` | 無 | `1000000`（1–52428800） |

憑證只有在工具實際執行時才需要：裝了插件但還沒填設定不會讓 profile 載入失敗。
`locale` 只切換工具與參數的描述；工具名稱與錯誤訊息一律維持英文。

## 安全邊界

- **預設唯讀。** 本版本沒有 `write`、`unlink` 或任何 workflow 動作。
- **Model 白名單。** 查詢限於 14 個標準 model：`res.partner`、`res.users`、`res.company`、
  `product.product`、`product.template`、`sale.order`、`sale.order.line`、`purchase.order`、
  `account.move`、`account.move.line`、`project.project`、`project.task`、`crm.lead`、`stock.quant`。
- **不允許關聯穿透。** domain 的欄位名不得含點號。要依關聯記錄過濾時，請先查詢關聯 model 取得 id，
  再用 `('partner_id','in',[ids])` 過濾。這讓白名單成為真正的能力邊界，而不只是建議。
- **不回傳 binary 欄位。** Odoo 型別為 `binary` 的欄位一律拒絕，預設欄位集也不含任何一個。
- **回應有上限。** 每個 model 有預設欄位集、`limit` ≤ 100、`offset + limit` ≤ 10000、
  單一字串值超過 2000 字元會截斷，並且每個回應都有硬性位元組上限。
- **只回傳未封存的記錄**；不開放 `active_test` context。
- **草稿建立需開啟且形式固定。** `sale.order` 一律以 `state=draft` 建立；
  `project.task` 不得指定 `state` 或 `stage_id`，階段由 Odoo 套用預設階段。
  只接受白名單欄位，並拒絕 one-to-many 命令。

## 0.1 的非目標

- 不做業務包裝工具（`list_customers`、`list_quotations` 等）。它們依賴無法在沒有真實 Odoo 的情況下
  驗證的欄位假設，而假設錯了會回傳空結果而非報錯——對 agent 而言是最糟的失敗模式。延到 0.2。
- 不做更新、刪除或 workflow 轉換；不處理附件與報表產生。
- 不做 XML-RPC 傳輸、不做 model 探索、不做多資料庫切換、不做 cursor 分頁。

## 開發

```sh
bun install
bun run lint
bun run typecheck
bun run test
bun run build
```

`scripts/smoke-odoo.sh` 是對真實伺服器的手動端到端檢查，刻意不納入 CI。

## 授權

MIT
