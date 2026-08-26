# dsh-odoo 設計 spec

- 日期：2026-08-26
- 套件名（npm，unscoped）：`dsh-odoo`
- GitHub：`maxmilian/dsh-odoo`（npm 帳號 `maxhsu`）
- 授權：MIT
- 骨架來源：`dsh-sonarqube`（六檔唯讀標準形）+ `dsh-forge`（多工具 / 四語 tool metadata）
- 狀態：**設計定案，尚未寫任何程式碼**
- 決策狀態：所有待決項目已於 2026-08-26 拍板，見 §12「決策紀錄」

---

## 1. 目的與差異化定位

### 目的
讓 DeepSeek Harness 的 agent 能安全地讀取 Odoo ERP 的業務資料（客戶、報價/訂單、專案任務、發票），
並在使用者明確開啟時，建立**極度受限的草稿記錄**。

### 差異化
- canonical registry 上 Odoo / ERP / CRM 類插件目前是 **0**，這是第一個。
- 與既有 DSH 插件的差別：dsh-sonarqube / dsh-forge 都是「開發者工具」，dsh-odoo 是「營運資料」。
  agent 從此可以回答「這個客戶今年下了幾張單」「這張報價卡在哪個階段」這類問題。
- 相對於市面上常見的 Odoo MCP server（多半直接把 `execute_kw` 整包開出去、可任意寫入）：
  本插件**預設唯讀**、**model 白名單**、**欄位與筆數強制裁剪**、**寫入需明確 opt-in 且只能建草稿**。
  這是可以送 registry 審核的形狀；「把 execute_kw 開出去」不是。

### 三個硬邊界（不可被推翻）
1. 唯讀為主。
2. `odoo_create_draft` 預設關閉，需 `config.allowWrite: true` 才**註冊**（關閉時該工具根本不出現在 tool list，
   而不是註冊後才拒絕——避免 agent 反覆嘗試）。
3. 寫入僅限 `sale.order` / `project.task`，且固定草稿狀態，其精確定義為：
   - `sale.order`：一律強制 `state = 'draft'`；呼叫端自帶 `state` 直接 `INVALID_INPUT`。
   - `project.task`：Odoo 此 model 沒有 `draft` 這個 state（17+ 的 `state` 是 `01_in_progress` 等），
     因此改為**禁止指定 `state` 與 `stage_id`**，讓記錄落在該專案的第一個階段（Odoo 預設新任務位置）。
   兩者都必須在工具描述（四語）中明講，不能只寫在程式碼裡。

### 專案慣例（本次新增，三個插件一致）
- **G1 — locale**：runtime tool metadata 四語，透過 `config.locale` 切換。tool **name 固定英文**，
  **description 與參數 description 依 locale 切換**。硬性要求，非可選。
- **G2 — 400 錯誤透出**：僅在「使用者輸入類錯誤」時，把上游錯誤說明過濾後透出給 agent。
  詳見 §6.2。**與 dsh-sonarqube「錯誤訊息永不夾帶上游 body」的既有慣例不同，此處為刻意例外，
  理由是 query / domain / values 語法錯誤若不回饋，agent 只能盲猜。**

---

## 2. 傳輸層決策

### 2.1 三個候選

| 方案 | endpoint | 認證 | Odoo 版本 | TS 成本 |
| --- | --- | --- | --- | --- |
| A. XML-RPC | `/xmlrpc/2/common`、`/xmlrpc/2/object` | uid + password/API key | 8 → 19，最穩 | **需自組 + 自解 XML** |
| B. JSON-RPC | `/jsonrpc`（service=`common`/`object`） | uid + password/API key | 8 → 18 皆有；19 需實測 | 純 `fetch` + `JSON`，零依賴 |
| C. Web session | `/web/session/authenticate` + `/web/dataset/call_kw` | cookie session | 17+ 較乾淨 | 需管 cookie/session 續期/CSRF |

### 2.2 分析

**A（XML-RPC）** 是 Odoo 官方文件的正典路徑、版本相容性最好，但對「零 runtime 依賴」的骨架慣例衝擊最大：
- 送出端要自己組 `<methodCall>`：型別對應（`<int>`/`<double>`/`<boolean>`/`<string>`/`<array>`/`<struct>`/`<nil>`）、
  XML entity escaping、Odoo domain 巢狀陣列 → 巢狀 `<array>`。約 120 行，可控。
- **接收端才是問題**：Node 沒有內建 XML parser，要自己寫 tokenizer 處理 CDATA、entity、`<nil/>`、
  `<base64>`、Odoo 回傳中大量 `false`（Odoo 用 `false` 表示 null）。約 150–200 行**高風險**程式碼，
  而且是「解析不受信任輸入」的程式碼——正是最不該手寫的那一類。
- 引入 `xmlrpc` / `fast-xml-parser` 則破壞零依賴慣例，且會讓 registry 的依賴審查面積變大。

**C（Web session）** 排除：cookie 生命週期 + session 失效重登 + 多實例反向代理的黏著性，
換來的只是「17+ 比較乾淨」，不值得。而且 API key 在此路徑上支援度不一致。

**B（JSON-RPC）** 送收兩端都是 JSON，`fetch` + `JSON.parse` 直接搞定，**零 runtime 依賴**，
與 dsh-sonarqube / dsh-forge 的 client 形狀幾乎一模一樣（同一套 timeout / bounded body / 錯誤正規化可複用）。
認證流程與 A 完全相同（`common.authenticate` 換 uid，之後每次呼叫帶 `db, uid, apiKey`）。

風險：`/jsonrpc` 是 `web` 模組提供的 controller。極少數部署（前面擋了 WAF、或 Odoo.sh 特定設定、
或 Odoo 19 之後的變動）可能 404。這個風險是**可偵測、可明確回報**的，不是靜默錯誤。

### 2.3 定案

**採用 B（JSON-RPC over `/jsonrpc`），v0.1 只做這一種傳輸。**

- `config.transport` 欄位 **v0.1 不做**（沒有第二個選項時的可配置性是浪費）。
  若日後真的遇到只有 XML-RPC 的部署，再開 0.2 加 `xmlrpc` 並在那時才付 XML 的代價。
- README 四語版本都要明講：本插件走 JSON-RPC，需要 Odoo 開放 `/jsonrpc`。

### 2.4 `/jsonrpc` 探測與失敗路徑（**手上沒有可實測的 Odoo，這條路徑要寫得最清楚**）

`OdooClient` 內含一個 per-instance 的 `#handshake: Promise<Handshake> | undefined`。
第一個需要 RPC 的工具呼叫觸發 handshake，之後所有呼叫重用同一個 Promise（失敗則清空，下次重試）。

handshake 兩步：

1. `POST {baseUrl}jsonrpc`，`params: { service: 'common', method: 'version', args: [] }`
2. 成功後 `params: { service: 'common', method: 'authenticate', args: [db, username, apiKey, {}] }`

判定順序（**必須照這個順序，先判 transport 再判認證**）：

| 觀察到的回應 | 判定 | code | 訊息（靜態） |
| --- | --- | --- | --- |
| HTTP 404 / 405 | endpoint 不存在 | `TRANSPORT_UNSUPPORTED` | `This Odoo server does not expose /jsonrpc. Check the reverse proxy, or that the "web" module is installed.` |
| HTTP 2xx 但 content-type 非 JSON（多半是 Odoo 的 HTML 登入頁或 proxy 錯誤頁） | endpoint 被攔截 | `TRANSPORT_UNSUPPORTED` | 同上，附 `status` |
| HTTP 2xx、JSON，但缺 `result` 也缺 `error` | 不是 JSON-RPC 端點 | `TRANSPORT_UNSUPPORTED` | `The /jsonrpc endpoint returned a response that is not JSON-RPC 2.0.` |
| HTTP 301/302/307/308 | 不跟隨（`redirect: 'manual'`） | `TRANSPORT_UNSUPPORTED` | `The /jsonrpc endpoint redirected; check baseUrl (http vs https, trailing path).` |
| `version` 成功，`authenticate` 回傳 `false` | 帳密/db 錯 | `AUTHENTICATION_FAILED` | `Odoo rejected the credentials. Check db, username, and apiKey.` |
| `version` 成功，`authenticate` 回 `error.data.name = odoo.exceptions.AccessDenied` | 同上 | `AUTHENTICATION_FAILED` | 同上 |
| `error.data.message` 含 `database ... does not exist`（**待 live 驗證，見 §9**） | db 名錯 | `INVALID_CONFIG` | `The configured Odoo database was not found.` |

`TRANSPORT_UNSUPPORTED` 的訊息**一律靜態**（不套 G2 透出），因為此時回應內容多半是 HTML 或 proxy 錯誤頁，
不是結構化欄位。

### 2.5 JSON-RPC 呼叫形狀（實作參考）

```
POST {baseUrl}jsonrpc
Content-Type: application/json

{ "jsonrpc": "2.0", "method": "call", "id": <n>, "params": {
    "service": "object", "method": "execute_kw",
    "args": [db, uid, apiKey, model, "search_read",
             [domain], { "fields": [...], "limit": n, "offset": n, "order": "...",
                         "context": { "allowed_company_ids": [id] } }] } }
```

**關鍵陷阱（必須寫進 client 與測試）**：JSON-RPC 失敗時 **HTTP 仍然是 200**，
錯誤在 body 的 `error` 物件（`error.data.name` 帶 Python exception 全名，`error.data.message` 帶人話訊息）。
不能只看 `response.ok`。

`id` 用單調遞增計數器（不用 `Math.random`，方便測試斷言）。

---

## 3. 唯讀工具形狀決策

### 3.1 分析

- **A（純通用 `odoo_search_read`）**：彈性最大，但
  (a) 工具描述只能寫得很空泛，registry 審核拿描述比對程式碼會覺得「這工具能做的事遠超描述」；
  (b) Odoo domain（polish notation、`['&', ('a','=',1), '|', ...]`）對 agent 極不友善，實測常組錯；
  (c) 沒有欄位預設時 Odoo 會回傳全部欄位，單筆 `res.partner` 就可能上百欄、含 base64 圖片 → 直接炸 context。
- **B（純業務工具）**：描述精準、參數是 agent 熟悉的語意（`state`、`customer`、`date_from`），
  裁剪策略每個工具可以量身訂做。缺點是覆蓋窄，使用者一問到庫存/會計科目就沒轍。
- **C（混合）**：業務工具負責 80% 的常見問題且描述精準；受限通用工具（model 白名單 + 強制預設欄位 +
  domain 驗證）負責長尾，描述可以誠實地寫成「在白名單 model 上做受限查詢」——這句話**能對照程式碼**，
  因為白名單是原始碼裡的常數。

### 3.2 定案

**採用 C（混合）**，並且刻意讓通用工具「看起來就受限」：
- 工具名叫 `odoo_search_read`，`model` 參數是 **enum**（不是自由字串），enum 內容就是白名單。
  這樣 registry 審核與 agent 都能一眼看到能力邊界，描述與程式碼一致。
- 另附 `odoo_describe_model`，讓 agent 在組 domain 前先問欄位（避免亂猜欄位名 → `INVALID_INPUT` 迴圈）。

---

## 4. v0.1 工具清單

共 **7 個唯讀工具** + **1 個 opt-in 寫入工具**。
全部 `isConcurrencySafe: () => true`；全部 `output` 走統一 `OUTPUT_SCHEMA`（`data` + `meta`），
`render` 成單一 JSON text（比照 dsh-sonarqube）。

**G1 適用於全部 8 個工具**：以下中文描述是規格說明；實際 `description` 與每個參數的 `description`
都從 `locales.ts` 依 `config.locale` 取（`en` / `zh-TW` / `zh-CN` / `ja` 四份），tool name 固定英文。

統一輸出：

```jsonc
{
  "data": <工具各自的 payload>,
  "meta": {
    "model": "sale.order",        // 有查 model 時
    "total": 137,                 // search_count，供分頁判斷
    "returned": 20,
    "offset": 0,
    "truncatedFields": ["note"],  // 有字串被裁切時才出現
    "odooVersion": "18.0"         // server_info 才出現
  }
}
```

`OUTPUT_SCHEMA`（`tools.ts` 常數，8 個工具共用）：

```jsonc
{ "type": "object", "additionalProperties": false, "properties": {
    "data": { "type": "json", "required": true },
    "meta": { "type": "object", "required": true, "additionalProperties": true } } }
```

所有唯讀工具的共同錯誤情境（不再逐一重複）：
`INVALID_CONFIG` / `TRANSPORT_UNSUPPORTED` / `AUTHENTICATION_FAILED` / `PERMISSION_DENIED` /
`NETWORK_ERROR` / `REQUEST_TIMEOUT` / `REQUEST_ABORTED` / `RESPONSE_TOO_LARGE` / `INVALID_RESPONSE` /
`SERVER_ERROR` / `ODOO_RPC_ERROR`。

### 4.1 `odoo_server_info`

- 描述（en）：`Read the connected Odoo server version and the authenticated user id.`
- 參數：無
- RPC：handshake（`common.version` + `common.authenticate`）
- 裁剪：只回 `serverVersion`、`serverSerie`、`protocolVersion`、`uid`、`db`、`companyId`（若有設定）。
  **不回傳** server 的其他內部欄位。
- 專屬錯誤：`TRANSPORT_UNSUPPORTED`（見 §2.4）

### 4.2 `odoo_describe_model`

- 描述（en）：`List the queryable fields of one allow-listed Odoo model: name, type, label, relation, and selection values.`
- 參數：`model`（enum，必填）
- RPC：`object.execute_kw(model, 'fields_get', [], { attributes: ['string','type','relation','selection','required','readonly'] })`
- 裁剪：
  - 只保留上述 6 個 attribute（原始 `fields_get` 每個欄位有 20+ 個 key）。
  - **排除** `type` 為 `binary` 的欄位（不讓 agent 有機會去要 base64）。
  - `selection` 超過 30 個選項時截斷，該欄位名記入 `meta.truncatedFields`。
  - 欄位數上限 200，超過依欄位名字典序取前 200，`meta.truncated` 設 `true`。
- 專屬錯誤：`MODEL_NOT_ALLOWED`

### 4.3 `odoo_search_read`（受限通用）

- 描述（en）：`Run a restricted search_read on one allow-listed Odoo model. When fields are omitted, a fixed default field set for that model is used.`
- 參數：
  - `model`：enum（白名單），必填
  - `domain`：array，選填，預設 `[]`（見 §5.3 domain 驗證）
  - `fields`：string[]，選填，1–30 個；省略時用 `DEFAULT_FIELDS[model]`
  - `limit`：integer，選填，預設 `config.defaultLimit`（20），上限 100
  - `offset`：integer，選填，預設 0，上限 10000
  - `order`：string，選填，格式 `field [asc|desc](, field [asc|desc])*`，最多 3 段
- RPC：`search_count`（取 `meta.total`）+ `search_read`，兩次呼叫序列送出
- 裁剪：
  - **fields 未指定時絕不放行「全欄位」**——一律套 `DEFAULT_FIELDS`。這是 v0.1 最重要的一條裁剪規則。
  - 明確拒絕 binary 類欄位名（`models.ts` 的 `BINARY_FIELDS` 常數：`image_1920`、`image_1024`、
    `image_512`、`image_256`、`image_128`、`avatar_1920`、`avatar_128`、`datas`、`raw`、`db_datas`）
    → `INVALID_INPUT`。
  - 每個字串值超過 2000 字元 → 截斷並在尾端加 `…[truncated]`，欄位名記入 `meta.truncatedFields`
    （Odoo 的 `description` / `note` / `body_html` 常是幾十 KB 的 HTML）。
  - many2one 一律以 Odoo 原生 `[id, display_name]` 形式回傳，不展平（省 token）。
  - 最終仍受 `maxResponseBytes` 保護（傳輸層）。
- 專屬錯誤：`MODEL_NOT_ALLOWED`、`INVALID_INPUT`（domain / fields / order 不合法）

### 4.4 `odoo_list_partners`

- 描述（en）：`Search Odoo contacts (customers or suppliers) by name, email, reference, company flag, or salesperson.`
- 參數：`query`（string 1–100，模糊比對 name/email/ref）、`kind`（enum：`customer` | `supplier` | `any`，預設 `any`）、
  `is_company`（boolean）、`limit`、`offset`
- model：`res.partner`；由程式組 domain（agent 不碰 domain）
  - `customer` → `[('customer_rank','>',0)]`；`supplier` → `[('supplier_rank','>',0)]`；`any` → 不加
  - `is_company` 有給 → `[('is_company','=',<bool>)]`
  - `query` → `['|','|',('name','ilike',q),('email','ilike',q),('ref','ilike',q)]`
- 欄位：`id, name, display_name, email, phone, is_company, parent_id, city, country_id, vat, customer_rank, supplier_rank`

### 4.5 `odoo_list_sale_orders`

- 描述（en）：`List Odoo quotations and sales orders, filtered by state, customer, or order-date range. Order lines are not included.`
- 參數：`state`（enum：`draft` | `sent` | `sale` | `done` | `cancel` | `any`，預設 `any`）、
  `partner_id`（integer）、`date_from` / `date_to`（`YYYY-MM-DD`）、`limit`、`offset`
- model：`sale.order`
- 欄位：`id, name, partner_id, date_order, state, amount_untaxed, amount_total, currency_id, user_id, client_order_ref`
- 裁剪：**不回傳 `order_line`**（明細另外查 `odoo_search_read('sale.order.line')`，避免一次爆量）
- 錯誤：日期格式不符 `^\d{4}-\d{2}-\d{2}$` → `INVALID_INPUT`

### 4.6 `odoo_list_project_tasks`

- 描述（en）：`List Odoo project tasks, filtered by project, assignee, stage name, or closed flag. Task descriptions are not included.`
- 參數：`project_id`（integer）、`user_id`（integer，比對 `user_ids`）、`stage_name`（string，ilike）、
  `is_closed`（boolean，選填；省略＝全部）、`limit`、`offset`
- model：`project.task`
- 欄位：`id, name, project_id, stage_id, user_ids, date_deadline, priority, state, partner_id, write_date`
- 裁剪：**不回傳 `description`**（HTML，動輒數十 KB）；需要時走 `odoo_search_read` 明確指定並吃 2000 字截斷。
- 相容性降級（**明確行為，不是「盡量」**）：`state` 與 `is_closed` 在 Odoo 17 之前的 `project.task` 不存在。
  client 對每個 model 做 **per-instance 一次** 的 `fields_get`（只取欄位名，快取在 `Map<model, Set<string>>`），
  請求欄位與 domain 欄位若不存在於該 Set：欄位從 `fields` 清單移除、domain 條件整條移除，
  並在 `meta.unsupportedFields: string[]` 回報。此降級**只套用在業務工具**；
  `odoo_search_read` 的欄位不存在時直接 `INVALID_INPUT`（agent 應先呼叫 `odoo_describe_model`）。

### 4.7 `odoo_list_invoices`

- 描述（en）：`List Odoo customer invoices or vendor bills, filtered by payment state, partner, or invoice-date range. Invoice lines are not included.`
- 參數：`kind`（enum：`customer`→`out_invoice` | `vendor`→`in_invoice`，預設 `customer`）、
  `payment_state`（enum：`not_paid` | `in_payment` | `paid` | `partial` | `reversed` | `any`，預設 `any`）、
  `partner_id`、`date_from` / `date_to`、`limit`、`offset`
- model：`account.move`（domain 固定含 `('move_type','in',[...])`，agent 無法藉此查到日記帳分錄）
- 欄位：`id, name, partner_id, invoice_date, invoice_date_due, state, payment_state, amount_untaxed, amount_total, amount_residual, currency_id`
- 裁剪：不回傳 `line_ids`、`narration`

### 4.8 `odoo_create_draft`（預設關閉）

- **只有 `config.allowWrite === true` 時才 `ctx.tools.register`。** 關閉時工具不存在。
- 描述（en）：`Create one draft record in Odoo. Only sale.order and project.task are allowed. A sale.order is always created with state=draft; a project.task may not specify state or stage_id and lands in the project's first stage.`
  （四語版本都必須包含這兩句草稿政策。）
- 參數：
  - `model`：enum `['sale.order', 'project.task']`，必填
  - `values`：object，必填
- 允許欄位白名單（**其餘欄位一律 `INVALID_INPUT` 拒絕，不是靜默忽略**）：
  - `sale.order`：`partner_id`(必填, int)、`date_order`(date)、`client_order_ref`(str ≤ 100)、
    `note`(str ≤ 2000)、`user_id`(int)
  - `project.task`：`name`(必填, str ≤ 200)、`project_id`(必填, int)、`description`(str ≤ 2000)、
    `date_deadline`(date)、`partner_id`(int)、`user_ids`(int[] ≤ 10)
- 草稿強制（§1 硬邊界 3 的實作面）：
  - `sale.order`：送出前把 `state` 設為 `'draft'`；`values` 自帶 `state` → `INVALID_INPUT`。
  - `project.task`：`values` 自帶 `state` 或 `stage_id` → `INVALID_INPUT`；兩者都不送，讓 Odoo 依
    `project_id` 落在該專案 sequence 最小的階段。
  - 一律**不接受** `order_line` / `invoice_line_ids` 等 One2many 命令（v0.1 非目標）。
    `user_ids` 是唯一的多值欄位，送出時轉成 `[[6, 0, ids]]` 命令。
- RPC：`object.execute_kw(model, 'create', [values], { context })`，接著 `read` 取回
  `sale.order` → `id, name, state`；`project.task` → `id, name, stage_id`，作為 `data` 回報。
- `isConcurrencySafe: () => true`（建立獨立記錄彼此不衝突）；`presentCall` 的 `kind` 標為 `write`。
- 專屬錯誤：`MODEL_NOT_ALLOWED`、`INVALID_INPUT`、`ODOO_VALIDATION_ERROR`（Odoo 的 `UserError`/
  `ValidationError`，例如缺必填的 pricelist——此類**適用 G2 透出**，見 §6.2）、`PERMISSION_DENIED`、
  `WRITE_DISABLED`（client 層防線；`allowWrite=false` 時工具未註冊，正常路徑不會觸發）

---

## 5. Config schema

### 5.1 欄位表

| config 欄位 | 環境變數 fallback | 型別 | 預設 | 上下界 / 說明 |
| --- | --- | --- | --- | --- |
| `baseUrl` | `ODOO_URL` | string | 必填 | http(s)、無內嵌帳密、無 query/fragment，尾端補 `/` |
| `db` | `ODOO_DB` | string | 必填 | 1–100 字元 |
| `username` | `ODOO_USERNAME` | string | 必填 | 1–200 字元 |
| `apiKey` | `ODOO_API_KEY` | string，`role('secret')` | 必填 | 1–200 字元；建議用 Odoo API Key 而非密碼 |
| `companyId` | `ODOO_COMPANY_ID` | number | 未設定 | 正整數 ≤ 2^31-1；設定後所有呼叫帶 `context.allowed_company_ids: [id]` |
| `allowWrite` | 無（刻意不吃 env） | boolean | `false` | `true` 才註冊 `odoo_create_draft` |
| `locale` | 無 | enum `en` / `zh-TW` / `zh-CN` / `ja` | `en` | **G1**：tool description 與參數 description 的語言；tool name 恆為英文 |
| `defaultLimit` | 無 | number | `20` | 1–100 |
| `requestTimeoutMs` | 無 | number | `30000` | 1 – 300000 |
| `maxResponseBytes` | 無 | number | `1000000`（1 MB） | 1 – 52428800（50 MiB） |

**plugin config 覆蓋環境變數**（`config.x?.trim() || env.X?.trim() || ''`），與 dsh-sonarqube 一致。
`allowWrite` 完全不吃 env，避免「環境裡不小心有個變數就開了寫入」。
`companyId` 由 `ODOO_COMPANY_ID` 讀入時以 `Number.parseInt(value, 10)` 解析，非正整數 → `INVALID_CONFIG`。

`Config` schema 本身（Schemastery）套 `.i18n(CONFIG_I18N)`，四語描述沿用 dsh-sonarqube 的做法，
key 覆蓋 `en` / `en-US` / `zh` / `zh-CN` / `zh-TW` / `ja` / `ja-JP`。

### 5.2 URL 驗證
沿用 dsh-sonarqube `normalizeBaseUrl`：`new URL()` 可解析、protocol ∈ {http:, https:}、
無 `username`/`password`、無 `search`/`hash`、pathname 尾端正規化為單一 `/`。違反 → `INVALID_CONFIG`。

### 5.3 Domain 驗證（`odoo_search_read` 專用，安全關鍵）
agent 給的 domain 必須通過：
- 頂層是 array，長度 ≤ 40，葉節點（三元組）≤ 20
- 每個元素是 `'&' | '|' | '!'` 字串，或長度 3 的 array
- 三元組：`[field, operator, value]`
  - `field`：`/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,2}$/`（最多兩層點號穿透）
  - `operator` ∈ `= != > >= < <= like not like ilike not ilike in not in child_of parent_of =like =ilike`
  - `value`：string（≤ 200）/ number / boolean / null，或上述的陣列（≤ 100 個元素）；
    **不接受巢狀物件**
- 任何違反 → `INVALID_INPUT`，訊息只說明違反了哪一條規則與出問題的索引位置，
  **不回顯 domain 的 value**（避免把 PII 打進 log）

---

## 6. 錯誤處理

### 6.1 錯誤碼清單

`OdooApiError`：`message` + `code` + 選填 `status` / `model` / `odooException` / `retryAfter` / `detail`。
`toJSON()` 只吐這些安全欄位，**永不夾帶 apiKey 或原始 response body**。

| # | code | 觸發情境 | G2 透出 |
| --- | --- | --- | --- |
| 1 | `INVALID_CONFIG` | baseUrl/db/username/apiKey 缺漏或不合法、數值超界 | 否 |
| 2 | `INVALID_INPUT` | 本插件自己驗出的參數問題：domain / fields / order / 日期格式 / values 欄位不允許 | 不適用（訊息本來就是自己寫的） |
| 3 | `AUTHENTICATION_FAILED` | `authenticate` 回 `false`；`odoo.exceptions.AccessDenied`；HTTP 401 | 否 |
| 4 | `PERMISSION_DENIED` | `odoo.exceptions.AccessError`；HTTP 403 | 否 |
| 5 | `NOT_FOUND` | `odoo.exceptions.MissingError`（記錄已刪）；HTTP 404（非 `/jsonrpc` 本身） | 否 |
| 6 | `RATE_LIMITED` | HTTP 429（多半來自前置 proxy），附 `retryAfter` | 否 |
| 7 | `REQUEST_TIMEOUT` | 超過 `requestTimeoutMs` | 否 |
| 8 | `REQUEST_ABORTED` | 呼叫端 `exec.signal` 取消 | 否 |
| 9 | `NETWORK_ERROR` | fetch 拋出、DNS/連線失敗 | 否 |
| 10 | `RESPONSE_TOO_LARGE` | `content-length` 或串流累積超過 `maxResponseBytes` | 否 |
| 11 | `INVALID_RESPONSE` | 非 JSON content-type、JSON 解析失敗、`result`/`error` 皆缺 | 否 |
| 12 | `SERVER_ERROR` | HTTP ≥ 500 | 否 |
| 13 | `ODOO_RPC_ERROR` | HTTP 200 但 body 有 `error`，且不屬於上述任何對應（保底） | 否 |
| 14 | `ODOO_VALIDATION_ERROR` | `odoo.exceptions.UserError` / `ValidationError` | **是** |
| 15 | `MODEL_NOT_ALLOWED` | 請求的 model 不在白名單（enum 已擋一層，此為 client 防線） | 否 |
| 16 | `WRITE_DISABLED` | `allowWrite=false` 時仍呼叫到 client 的 create（防線） | 否 |
| 17 | `TRANSPORT_UNSUPPORTED` | `/jsonrpc` 404/405/重導/非 JSON/非 JSON-RPC（見 §2.4） | 否 |
| 18 | `ODOO_HTTP_ERROR` | 其餘非 2xx 的保底；HTTP 400 亦落此碼 | **是**（僅 400） |

Odoo exception 名稱 → code 的對應表寫在 `errors.ts` 常數，**由 `error.data.name` 精確比對**，
不做字串模糊比對（Odoo 錯誤訊息會被 i18n，模糊比對必壞）。
`error.data.name` 缺失或不在對應表 → `ODOO_RPC_ERROR`。

### 6.2 G2 — 使用者輸入錯誤的訊息透出

**與 dsh-sonarqube「錯誤訊息永不夾帶上游 body」的既有慣例不同，此處為刻意例外，
理由是 query / domain / values 語法錯誤若不回饋，agent 只能盲猜。**

適用範圍（**只有這兩種，其餘一律靜態訊息**）：
1. HTTP `400`（`ODOO_HTTP_ERROR`）
2. JSON-RPC error 且 `error.data.name` ∈ `{odoo.exceptions.UserError, odoo.exceptions.ValidationError}`
   （`ODOO_VALIDATION_ERROR`）——這是 Odoo 對「使用者輸入不合業務規則」的正規表達，等同 HTTP 400 的語意

取值來源（**只取結構化欄位，不得整包丟 response body**）：
- JSON-RPC：`error.data.message`（string）；缺則 `error.message`；再缺則不透出
- 純 HTTP 400：body 若為 JSON 且有 `error.data.message` / `error.message` 則取之；否則不透出

淨化管線 `sanitizeDetail(raw): string | undefined`（`errors.ts`）：
1. 非 string → `undefined`
2. 移除換行/控制字元（`\s+` 併為單一空格）、`trim()`
3. **redaction**：以下 pattern 命中即整段替換為 `[redacted]`
   - 目前設定的 `apiKey` 值（完全比對子字串）
   - `/(?:api[_-]?key|token|password|secret|authorization|bearer)\s*[:=]\s*\S+/gi`
   - 長度 ≥ 20 的連續 `[A-Za-z0-9_\-]` 字串（Odoo API key 形狀）
4. **截斷至 200 字元**（超過取前 197 + `...`）
5. 結果為空字串 → `undefined`

放置位置：`OdooApiError.detail`，並串接進 `message`：`"<靜態訊息> Odoo said: <detail>"`。
`detail` 為 `undefined` 時 `message` 就只有靜態訊息。

---

## 7. 檔案結構與職責

```
dsh-odoo/
├── src/
│   ├── index.ts        Cordis 入口：name / inject / Config schema（含 locale）/ apply（allowWrite 分支）
│   ├── config.ts       config 解析 + 驗證 + 上下界常數
│   ├── errors.ts       OdooApiError + 18 個 code + HTTP/Odoo exception 對應 + sanitizeDetail（G2）
│   ├── rpc.ts          JSON-RPC 傳輸：fetch、timeout、bounded body、JSON-RPC error 解包、error 正規化
│   ├── client.ts       handshake/uid 快取、欄位存在性快取、search_read、fields_get、create、裁剪
│   ├── models.ts       白名單、DEFAULT_FIELDS、BINARY_FIELDS、create 允許欄位表
│   ├── domain.ts       domain / fields / order / 日期 驗證
│   ├── tools.ts        createOdooTools(client, locale, allowWrite) → 7 或 8 個工具定義
│   ├── locales.ts      G1：CONFIG_I18N + OdooMessages 四語（工具描述、標題、每個參數說明）
│   └── types.ts        JsonValue / ApiResult / 參數型別
├── tests/              vitest（見 §8）
├── scripts/smoke-odoo.sh   手動 live 驗證腳本（不進 CI，見 §9）
├── .github/workflows/  ci.yml、release.yml
├── cordis.patch.yml
├── README.md / README.zh-TW.md / README.zh-CN.md / README.ja.md
├── LICENSE（MIT）
├── package.json、tsconfig.json、tsconfig.build.json、biome.json、vitest.config.ts
```

`tools.ts` 的形狀照 dsh-forge：`createOdooTools(client, locale, allowWrite)` 回傳 tool definition 陣列，
`index.ts` 的 `apply` 逐一 `ctx.tools.register`。locale 在建構期解析成 `OdooMessages`，
每個 tool 的 `description` / 參數 `description` 直接引用 messages 欄位。

### 預估行數

| 檔案 | 行數 | 說明 |
| --- | --- | --- |
| `index.ts` | ~95 | Schema（10 欄）+ allowWrite 分支註冊 |
| `config.ts` | ~150 | 比 sonarqube 多 db/username/companyId/allowWrite/locale/defaultLimit |
| `errors.ts` | ~190 | 18 個 code + Odoo exception 對應 + sanitizeDetail |
| `rpc.ts` | ~200 | timeout/abort/bounded body/JSON-RPC error 解包/redirect manual |
| `client.ts` | ~300 | handshake、欄位快取降級、5 個業務查詢的 domain 組裝、裁剪 |
| `models.ts` | ~120 | 純常數表 |
| `domain.ts` | ~130 | 驗證 |
| `tools.ts` | ~310 | 8 個工具，描述全走 messages |
| `locales.ts` | ~330 | 四語 × (config 10 欄 + 8 工具描述/標題 + ~25 個參數說明) |
| `types.ts` | ~70 | |
| **合計** | **~1900** | 比 dsh-forge（1001）大，主因是四語 locales、domain 驗證與 G2 淨化 |

### package.json 硬性要求
```jsonc
{
  "name": "dsh-odoo",
  "license": "MIT",
  "keywords": ["deepseek-harness", "dsh-plugin", "odoo", "erp", "crm"],
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-tools": "^0.1.0-rc.8 || ^0.1.1-rc.2",
    "@deepseek-ai/schemastery": "^3.18.1"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```
- `dsh.bundle.patch` **必須存在**；只宣告 `dsh.client` 會被 registry 退件。
- `@deepseek-ai/*` 一律放 `peerDependencies`，且範圍**必須顯式列出 prerelease 分支**
  （`^0.1.0-rc.8 || ^0.1.1-rc.2`）。只寫 `^0.1.0-rc.8` 會被 node-semver 靜默排除 `0.1.1-rc.2`，
  使用者安裝直接 ERESOLVE——dsh-sonarqube 實際踩過。
- `files` 必須含 `lib`、`cordis.patch.yml`、四份 README、`LICENSE`。
- GitHub repo topics：`dsh-plugin` + `odoo`。

### cordis.patch.yml
```yaml
- insert:
    - id: dsh-odoo
      name: dsh-odoo
      config:
        baseUrl: ''
        db: ''
        username: ''
        apiKey: ''
        allowWrite: false
        locale: en
        defaultLimit: 20
        requestTimeoutMs: 30000
        maxResponseBytes: 1000000
```

### release workflow 要點（`v*` tag 觸發）
1. checkout → setup-bun → `bun install --frozen-lockfile`
2. **先驗 tag 與 package.json 版本一致**：`test "$GITHUB_REF_NAME" = "v${PACKAGE_VERSION}"`
3. `lint` → `typecheck` → `test --coverage` → `build`
4. `bun pm pack`，產出 `dsh-odoo-<version>.tgz`，另 `cp` 一份穩定檔名 `dsh-odoo.tgz`
   （讓 `releases/latest/download/dsh-odoo.tgz` 跨版本不壞），產 `SHA256SUMS`
5. **tarball 檔名必須透過 `$GITHUB_ENV` 傳給下一個 step**
   （`echo "PACKAGE_TARBALL=$PACKAGE_TARBALL" >>"$GITHUB_ENV"`）——跨 step 的 shell 變數不保留，
   dsh-forge v0.3.2 因此掛過。
6. `gh release create "$GITHUB_REF_NAME" "$PACKAGE_TARBALL" dsh-odoo.tgz SHA256SUMS --verify-tag --generate-notes`

CI 另含 pack smoke test（比對 tarball 內含 `lib/index.js`、`lib/locales.js`、`cordis.patch.yml`、四份 README、LICENSE）
與 Node 22.19 / 24 雙版本 runtime 匯入測試。

---

## 8. 測試策略（vitest，mock fetch）

不打真的 Odoo。所有測試注入假的 `FetchImplementation`（與 dsh-sonarqube 的 client 建構子相同做法）。

| 檔案 | 覆蓋 |
| --- | --- |
| `tests/config.test.ts` | env vs config 優先序、`allowWrite` 不吃 env、URL 拒絕（ftp、含帳密、含 query/fragment）、數值上下界、缺 db/username/apiKey、`ODOO_COMPANY_ID` 非整數 |
| `tests/domain.test.ts` | domain 合法/非法各案例、fields 上限與 `BINARY_FIELDS` 拒絕、order 格式、日期格式、錯誤訊息不含 domain value |
| `tests/rpc.test.ts` | **HTTP 200 + `error` body 必須拋錯**（最重要）、`/jsonrpc` 404/405/302/HTML/非 JSON-RPC 五條 `TRANSPORT_UNSUPPORTED` 路徑、各 Odoo exception → code 對應、超過 maxResponseBytes（content-length 與串流兩路）、timeout、caller abort、429 `retryAfter`、5xx |
| `tests/errors.test.ts` | **G2**：400 與 UserError 會帶 `detail`；401/403/404/500 一律無 `detail`；`sanitizeDetail` 截斷至 200 字元、apiKey 原值被 `[redacted]`、`token=xxx` 形式被 redact、長 base62 字串被 redact、非 string 回 `undefined` |
| `tests/client.test.ts` | `authenticate` 回 `false` → `AUTHENTICATION_FAILED`；handshake 只做一次（第二次工具呼叫不重打 authenticate），失敗後可重試；fields 省略時送出的 `fields` 等於 `DEFAULT_FIELDS`；字串截斷與 `meta.truncatedFields`；`companyId` 有設定時 context 帶 `allowed_company_ids`；`project.task` 缺 `state` 時業務工具降級並回 `meta.unsupportedFields`，而 `odoo_search_read` 同情境回 `INVALID_INPUT` |
| `tests/tools.test.ts` | 每個業務工具組出的 domain 正確（斷言送出的 RPC payload）；`model` enum 拒絕白名單外的值；`create_draft` 的 values 白名單、`sale.order` 強制 `state='draft'`、`project.task` 帶 `state` 或 `stage_id` → `INVALID_INPUT`、`user_ids` 轉 `[[6,0,ids]]`；全部工具 `isConcurrencySafe() === true` |
| `tests/locales.test.ts` | **G1**：四種 locale 各建一次工具，tool **name 完全相同且為英文**；`description` 四語互不相同且皆非空；每個參數都有該 locale 的 description；`odoo_create_draft` 的四語描述都含草稿政策的兩句話 |
| `tests/plugin.test.ts` | `name`/`inject`/`Config` 存在；`Config` 四語 i18n 描述；`allowWrite=false` 註冊 7 個工具、`allowWrite=true` 註冊 8 個且含 `odoo_create_draft`；`locale` 預設 `en` |

覆蓋率門檻比照 dsh-sonarqube：branches/functions/lines/statements 各 80%，`src/types.ts` 排除。

---

## 9. Live 驗證計畫（**目前手上沒有可實測的 Odoo**）

因此 v0.1 的所有相容性假設一律採保守寫法，並在 README 明白標示「尚未對真實 Odoo 做過 live 驗證」，
待第一次接到真實實例後補上「驗證於 Odoo x.y，日期 yyyy-mm-dd」。

`scripts/smoke-odoo.sh`（手動執行，不進 CI）依序跑：`odoo_server_info` → `odoo_describe_model('res.partner')`
→ `odoo_list_partners` → `odoo_list_sale_orders` → `odoo_search_read('sale.order.line')`
→（`allowWrite=true` 時）`odoo_create_draft`。

### 第一次接到真實 Odoo 時必須驗證的假設清單

| # | 假設 | 若不成立的回退方案 |
| --- | --- | --- |
| 1 | `/jsonrpc` 存在且接受 `service: common/object` | 已有 `TRANSPORT_UNSUPPORTED` 明確錯誤；真的普遍不成立才開 0.2 做 XML-RPC |
| 2 | JSON-RPC 錯誤時 HTTP 為 200、錯誤在 `error.data.name` / `error.data.message` | 若實際回非 200，`rpc.ts` 的 HTTP 分支已先接住；補測試案例即可 |
| 3 | Odoo API Key 可直接當 `authenticate` 的 password 使用 | 回退成要求使用者填真實密碼，README 加註 |
| 4 | db 名錯誤時的錯誤訊息可辨識（§2.4 最後一列） | 移除該列的特判，一律回 `AUTHENTICATION_FAILED` |
| 5 | model 不存在（模組未安裝）時的 `error.data.name` 值 | 目前保守歸類為 `ODOO_RPC_ERROR`；實測後若有穩定 exception 名稱，再對應成 `NOT_FOUND` 並在訊息提示「模組未安裝」 |
| 6 | `project.task` 有 `state` 與 `is_closed`（17+） | 已有 §4.6 欄位存在性降級機制吸收 |
| 7 | `account.move.payment_state` 的 selection 值就是 spec 列的六種 | 參數 enum 改為由 `fields_get` 取得的值做驗證，或放寬為字串 + 白名單字元檢查 |
| 8 | `res.partner` 的 `customer_rank` / `supplier_rank` 存在（12+） | 同 #6，走欄位存在性降級，`kind` 過濾失效時回 `meta.unsupportedFields` |
| 9 | `fields_get` 的 `attributes` 參數受支援 | 改為取回全部 attribute 後在 client 端過濾（回應變大，但行為不變） |
| 10 | 建立 `project.task` 不指定 `stage_id` 時會落在第一個階段 | 若落在別處，改為先查該 project 的最小 sequence stage 再顯式帶入 |

---

## 10. 非目標（v0.1 明確不做）

1. **不做任何更新/刪除**：無 `write`、`unlink`、`copy`、workflow 動作（`action_confirm`、`action_post` 等）。
2. **不做 One2many 明細建立**：`odoo_create_draft` 不接受 `order_line` / subtask。
3. **不做附件**：不讀不寫 `ir.attachment`，不回傳任何 base64/binary 欄位。
4. **不做 XML-RPC 傳輸**（見 §2.3），也不做 `/web/dataset/call_kw` session 路徑。
5. **不做 model 探索**：沒有「列出這台 Odoo 有哪些 model」的工具；白名單是原始碼常數。
6. **不做 report/PDF 產生**、不做 `render_qweb_pdf`。
7. **不做 Odoo Studio / 自訂 model 支援**（白名單只含標準 model，且不可由 config 擴充）。
8. **不做多資料庫切換**：一個 plugin instance 綁一個 `db`。
9. **不做 cursor 分頁或自動翻頁**：只有 `limit`/`offset`，`meta.total` 讓 agent 自己決定要不要再翻。
10. **不做 webhook / 即時通知**。
11. **不做寫入的稽核 log 落地**（v0.1 只在回應裡帶回建立的 id）。
12. **不做 `config.transport` 可配置**（只有 JSON-RPC 一種）。

---

## 11. 白名單（`models.ts`）

唯讀白名單（`odoo_search_read` 與 `odoo_describe_model` 的 enum，共 14 個）：

| model | 用途 | DEFAULT_FIELDS |
| --- | --- | --- |
| `res.partner` | 客戶/供應商/聯絡人 | id, name, display_name, email, phone, is_company, parent_id, city, country_id, vat |
| `res.users` | 使用者（業務員） | id, name, login, active |
| `res.company` | 公司 | id, name, currency_id |
| `product.product` | 產品變體 | id, name, default_code, list_price, uom_id, type, active |
| `product.template` | 產品範本 | id, name, default_code, list_price, categ_id, type |
| `sale.order` | 報價/訂單 | 見 §4.5 |
| `sale.order.line` | 訂單明細 | id, order_id, product_id, name, product_uom_qty, price_unit, price_subtotal |
| `purchase.order` | 採購單 | id, name, partner_id, date_order, state, amount_total, currency_id |
| `account.move` | 發票/帳單 | 見 §4.7 |
| `account.move.line` | 發票明細 | id, move_id, name, account_id, debit, credit, balance |
| `project.project` | 專案 | id, name, partner_id, user_id, active |
| `project.task` | 任務 | 見 §4.6 |
| `crm.lead` | 商機 | id, name, partner_id, stage_id, expected_revenue, probability, user_id, date_deadline |
| `stock.quant` | 庫存量 | id, product_id, location_id, quantity, available_quantity, lot_id |

都是標準 Odoo CE model。`sale`/`purchase`/`account`/`project`/`crm`/`stock` 模組未安裝的實例，
呼叫時的錯誤歸類見 §9 假設 #5。

---

## 12. 決策紀錄（2026-08-26 拍板）

### 全域慣例
- **已定：G1 — runtime tool metadata 四語走 `config.locale`（照 dsh-forge 的 `createXxxTools(client, locale)`）**
  —— tool name 固定英文、description 與參數 description 依 locale 切換，硬性要求；影響 §4 前言、§5.1、§7、§8 `locales.test.ts`。
- **已定：G2 — 錯誤訊息「過濾後透出，僅限使用者輸入類錯誤」**
  —— 僅 HTTP 400 與 Odoo `UserError`/`ValidationError` 透出 `error.data.message`，經 redaction 後截斷至 200 字元；
  這是刻意偏離 dsh-sonarqube 慣例的例外，理由是 query/domain/values 語法錯誤若不回饋，agent 只能盲猜。詳見 §6.2。

### 個別
- **已定：D1 傳輸層 — 只做 JSON-RPC `/jsonrpc`** —— 零 runtime 依賴且與現有骨架同形，相容性缺口可偵測、可明說（§2.4），不是靜默失敗。
- **已定：D2 工具形狀 — 混合 C（5 業務工具 + `odoo_search_read`（model 為 enum）+ `odoo_describe_model`）** —— enum 讓「受限」在 schema 上就看得見，描述與程式碼可對照，同時保留長尾查詢能力。
- **已定：D3 白名單 — 固定在原始碼，不可由 config 擴充** —— 保持工具描述與審核結論可預測；有真實需求再開 0.2。
- **已定：D4 多公司 — 只有 config 層單值 `companyId`，工具不提供 company 參數** —— 多公司是部署層設定，讓 agent 能切公司會使「這個 profile 看得到哪些資料」不可預測。
- **已定：D5 `project.task` 草稿定義 — 禁止指定 `state` 與 `stage_id`，落在專案第一個階段** —— Odoo 此 model 沒有 `draft` state，這是語意最接近且實作最單純的等價物；`sale.order` 仍強制 `state='draft'`。兩條政策都寫進四語工具描述。
- **已定：D6 字串截斷 — 單一字串值上限 2000 字元 + `maxResponseBytes` 預設 1 MB** —— 只靠 byte 上限會讓「查一筆任務」這種正常操作整個失敗。
- **已定：D7 筆數 — `defaultLimit` 預設 20（config 可調 1–100），單次 `limit` 硬上限 100** —— 搭配 `meta.total` 足以判斷是否翻頁，硬上限與 dsh-sonarqube 的 `MAX_PAGE_SIZE` 一致。
- **已定：D8 `stock.quant` / `crm.lead` — 兩者進唯讀白名單，但不做專屬業務工具** —— 白名單邊際成本只有一行常數，專屬工具才是維護成本。
