# dsh-odoo 設計 spec

- 日期：2026-08-26（v0.1 範圍於同日依 review 收斂）
- 套件名（npm，unscoped）：`dsh-odoo`
  - 已查 npm registry：`dsh-odoo` 為 404（未被佔用），確定使用。
  - **回退**：若發布時被搶註，改用 `@maxhsu/dsh-odoo`（比照 dsh-forge）。此名稱同時決定
    CI pack smoke test 的 grep 字串與 release workflow 的 tarball 檔名（§7），改名時三處要一起改。
- GitHub：`maxmilian/dsh-odoo`（npm 帳號 `maxhsu`）
- 授權：MIT
- 骨架來源：`dsh-sonarqube`（六檔唯讀標準形，**本插件的主要範本**）+ `dsh-forge`（四語 tool metadata 的做法）
- 狀態：**設計定案，尚未寫任何程式碼**
- 決策狀態：所有待決項目已拍板，見 §12「決策紀錄」

---

## 1. 目的與差異化定位

### 目的
讓 DeepSeek Harness 的 agent 能安全地讀取 Odoo ERP 的業務資料（客戶、報價/訂單、專案任務、發票），
並在使用者明確開啟時，建立**極度受限的草稿記錄**。

### 差異化
- canonical registry 上 Odoo / ERP / CRM 類插件目前是 **0**，這是第一個。
- 與既有 DSH 插件的差別：dsh-sonarqube / dsh-forge 都是「開發者工具」，dsh-odoo 是「營運資料」。
- 相對於市面上常見的 Odoo MCP server（多半直接把 `execute_kw` 整包開出去、可任意寫入）：
  本插件**預設唯讀**、**model 白名單**、**欄位與筆數強制裁剪**、**domain 不允許關聯穿透**、
  **寫入需明確 opt-in 且只能建草稿**。這是可以送 registry 審核的形狀；「把 execute_kw 開出去」不是。

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
  **description、參數 description、`presentCall` 的 title 依 locale 切換**。硬性要求，非可選。
  **豁免**：所有錯誤訊息（`OdooApiError.message`）**一律英文靜態**，不隨 locale 切換，也不需要翻譯。
  理由：錯誤訊息要與程式碼常數一一對應、便於使用者搜尋與比對測試斷言；透出的上游 detail 更是原樣（§6.2）。
- **G2 — 使用者輸入錯誤訊息透出**：僅在「使用者輸入類錯誤」時，把上游錯誤說明過濾後透出給 agent。
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
- 送出端要自己組 `<methodCall>`：型別對應、XML entity escaping、domain 巢狀陣列 → 巢狀 `<array>`。約 120 行，可控。
- **接收端才是問題**：Node 沒有內建 XML parser，要自己寫 tokenizer 處理 CDATA、entity、`<nil/>`、
  `<base64>`、Odoo 大量以 `false` 表示 null。約 150–200 行**高風險**程式碼，
  而且是「解析不受信任輸入」的程式碼——正是最不該手寫的那一類。
- 引入 `xmlrpc` / `fast-xml-parser` 則破壞零依賴慣例，並擴大 registry 的依賴審查面積。

**C（Web session）** 排除：cookie 生命週期 + session 失效重登 + 反向代理黏著性，
換來的只是「17+ 比較乾淨」，不值得；且 API key 在此路徑支援度不一致。

**B（JSON-RPC）** 送收兩端都是 JSON，`fetch` + `JSON.parse` 直接搞定，**零 runtime 依賴**，
與 dsh-sonarqube 的 client 形狀幾乎一模一樣（同一套 timeout / bounded body / 錯誤正規化可複用）。
認證流程與 A 相同（`common.authenticate` 換 uid，之後每次呼叫帶 `db, uid, apiKey`）。

風險：`/jsonrpc` 由 `web` 模組提供。少數部署（WAF、Odoo.sh 特定設定、Odoo 19 之後的變動）可能 404。
這個風險是**可偵測、可明確回報**的，不是靜默錯誤。

### 2.3 定案

**採用 B（JSON-RPC over `/jsonrpc`），v0.1 只做這一種傳輸。**
`config.transport` **不做**（沒有第二個選項時的可配置性是浪費）。若日後遇到只有 XML-RPC 的部署，
再開 0.2 加 `xmlrpc` 並在那時才付 XML 的代價。四語 README 都要明講需要 Odoo 開放 `/jsonrpc`。

### 2.4 Client 生命週期與 handshake（**blocker #1 定案**）

**`apply(ctx, config)` 建立單一 `OdooClient` 實例**（eager，沿用 dsh-sonarqube 的
`const client = createSonarQubeClient(config)` 寫法），並把該實例傳給
`createOdooTools(client, config.locale, config.allowWrite)`。

**明確不採用 dsh-forge 的 per-call factory 寫法**（`const client = () => createClient(config, env)`）：
那種寫法每次工具呼叫都新建 client，會讓下述 handshake 與欄位快取每次重建，
等於每次查詢重打一次 `authenticate` + `fields_get`。快取的生命週期綁 **plugin instance**。

`OdooClient` 內含 `#handshake: Promise<Handshake> | undefined`：
第一個需要 RPC 的工具呼叫觸發，之後所有呼叫重用同一個 Promise；**失敗則清空**，下次呼叫重試。

handshake 三步：

1. `POST {baseUrl}jsonrpc`，`params: { service: 'common', method: 'version', args: [] }`
2. `params: { service: 'common', method: 'authenticate', args: [db, username, apiKey, {}] }` → uid
3. **只在 `companyId` 有設定時**：`object.execute_kw(res.users, 'read', [[uid], ['company_ids']])`，
   確認 `companyId` ∈ `company_ids`；不在其中 → `INVALID_CONFIG`
   （訊息：`The configured companyId is not among the authenticated user's allowed companies.`）。
   這一步是為了避免後續每個查詢都因 `allowed_company_ids` 被 Odoo 擋成 `AccessError`，
   讓使用者收到誤導性的「權限不足」而非「companyId 設錯」（§9 假設 #7）。

### 2.5 `/jsonrpc` 探測與失敗路徑（**手上沒有可實測的 Odoo，這條路徑要寫得最清楚**）

判定順序（**必須照這個順序，先判 transport 再判認證**）：

| 觀察到的回應 | 判定 | code | 訊息（靜態英文） |
| --- | --- | --- | --- |
| HTTP 404 / 405 | endpoint 不存在 | `TRANSPORT_UNSUPPORTED` | `This Odoo server does not expose /jsonrpc. Check the reverse proxy, or that the "web" module is installed.` |
| HTTP 2xx 但 content-type 非 JSON（Odoo 登入頁或 proxy 錯誤頁） | endpoint 被攔截 | `TRANSPORT_UNSUPPORTED` | 同上，附 `status` |
| HTTP 2xx、JSON，但缺 `result` 也缺 `error` | 不是 JSON-RPC 端點 | `TRANSPORT_UNSUPPORTED` | `The /jsonrpc endpoint returned a response that is not JSON-RPC 2.0.` |
| HTTP 301/302/307/308 | 不跟隨（`redirect: 'manual'`） | `TRANSPORT_UNSUPPORTED` | `The /jsonrpc endpoint redirected; check baseUrl (http vs https, trailing path).` |
| `version` 成功，`authenticate` 回 `false` | 帳密/db 錯 | `AUTHENTICATION_FAILED` | `Odoo rejected the credentials. Check db, username, and apiKey.` |
| `version` 成功，`authenticate` 回 `error.data.name = odoo.exceptions.AccessDenied` | 同上 | `AUTHENTICATION_FAILED` | 同上 |
| `error.data.message` 含 `database ... does not exist`（**待 live 驗證，§9 #4**） | db 名錯 | `INVALID_CONFIG` | `The configured Odoo database was not found.` |

`TRANSPORT_UNSUPPORTED` 的訊息**一律靜態**（不套 G2 透出），因為此時回應多半是 HTML 或 proxy 錯誤頁，
不是結構化欄位。

### 2.6 JSON-RPC 呼叫形狀（實作參考）

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
不能只看 `response.ok`。`id` 用單調遞增計數器（不用 `Math.random`，方便測試斷言）。

---

## 3. 工具形狀決策

### 3.1 分析

- **A（純通用 `odoo_search_read`）**：彈性最大，但描述空泛、domain 對 agent 不友善、未指定欄位會回全欄位。
- **B（純業務工具）**：描述精準、參數語意直觀，但覆蓋窄，且**每一個業務工具的價值都建立在
  「欄位名 / state 值 / selection 值 / 欄位存在性」這些只有文件背書的假設上**。
- **C（混合）**：兩者都做。

### 3.2 定案：受限通用 + 描述精準（v0.1 收斂）

**v0.1 只做 4 個工具**：`odoo_server_info` / `odoo_describe_model` / `odoo_search_read` / `odoo_create_draft`。

原本規劃的 4 個業務包裝工具（`odoo_list_partners` / `odoo_list_sale_orders` /
`odoo_list_project_tasks` / `odoo_list_invoices`）**延到 0.2**，理由照實寫進 §10：
它們的正確性完全依賴未經實測的 Odoo 欄位假設（`customer_rank` 是否存在、`project.task.state` 的值域、
`account.move.payment_state` 的 selection、日期欄位是 date 還是 datetime）；
**假設錯了不會報錯，只會靜默回空結果**——對 agent 而言這是最糟的失敗模式。
在拿到可實測的 Odoo 實例之前不做。

受限性怎麼「一眼可見」：
- `odoo_search_read` 的 `model` 參數是 **enum**（不是自由字串），enum 內容就是原始碼裡的 14 個 model 白名單。
- `domain` 的欄位名**不允許任何點號**（§5.4），因此不存在跨 model 的關聯穿透。
- `fields` 未指定時一律套該 model 的 `DEFAULT_FIELDS`，且拒絕 `binary` 型別欄位（§4.5）。
- `odoo_describe_model` 讓 agent 在組 domain 前先問欄位，避免亂猜欄位名 → 錯誤迴圈。

---

## 4. v0.1 工具清單

共 **3 個唯讀工具** + **1 個 opt-in 寫入工具**。
全部 `isConcurrencySafe: () => true`；全部 `output` 走統一 `OUTPUT_SCHEMA`（`data` + `meta`），
`render` 成單一 JSON text（比照 dsh-sonarqube）。

**G1 適用於全部 4 個工具**：以下中文描述是規格說明；實際 `description`、每個參數的 `description`、
以及 `odoo_create_draft` 的 `presentCall` title，都從 `locales.ts` 依 `config.locale` 取
（`en` / `zh-TW` / `zh-CN` / `ja` 四份），tool name 固定英文。

**presentCall 定案（blocker #2）**：v0.1 **只有 `odoo_create_draft` 提供 `presentCall`**，
`{ card: 'generic', title: messages.createDraftTitle, kind: 'edit' }`。
`kind` 用 `'edit'`——`@deepseek-ai/dsh-tools` 的 `ToolCallKind` 是
`'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other'`，**沒有 `'write'`**。
三個唯讀工具**不做** `presentCall`（比照 dsh-sonarqube 全部不做）；理由是唯讀呼叫沒有需要使用者事前辨識的風險，
而寫入呼叫有。因此 `locales.ts` 只有**一個** title 字串，§8 的 `locales.test.ts` 也只斷言這一個。

### 4.1 統一輸出契約

```jsonc
{ "data": <工具各自的 payload>, "meta": { ... } }
```

`OUTPUT_SCHEMA`（`tools.ts` 常數，4 個工具共用）：

```jsonc
{ "type": "object", "additionalProperties": false, "properties": {
    "data": { "type": "json", "required": true },
    "meta": { "type": "object", "required": true, "additionalProperties": true } } }
```

`meta` 的完整 key 契約（**只有這些 key，各工具用到才出現**）：

| key | 型別 | 出現於 |
| --- | --- | --- |
| `model` | string | `describe_model`、`search_read`、`create_draft` |
| `total` | number | `search_read`（`search_count` 結果） |
| `returned` | number | `search_read`、`describe_model`（欄位數） |
| `offset` | number | `search_read` |
| `truncatedFields` | string[] | `search_read`（字串值被截斷）、`describe_model`（selection 被截斷） |
| `truncated` | boolean | `describe_model`（欄位數超過 200 而被截斷） |
| `odooVersion` | string | `odoo_server_info` |

### 4.2 各工具的共同錯誤情境

（以下每個工具不再重複列）
`INVALID_CONFIG` / `TRANSPORT_UNSUPPORTED` / `AUTHENTICATION_FAILED` / `PERMISSION_DENIED` /
`NOT_FOUND` / `RATE_LIMITED` / `NETWORK_ERROR` / `REQUEST_TIMEOUT` / `REQUEST_ABORTED` /
`RESPONSE_TOO_LARGE` / `INVALID_RESPONSE` / `SERVER_ERROR` / `ODOO_RPC_ERROR`。

### 4.3 `odoo_server_info`

- 描述（en）：`Read the connected Odoo server version and the authenticated user id.`
- 參數：無
- RPC：handshake（§2.4）
- 裁剪：只回 `serverVersion`、`serverSerie`、`protocolVersion`、`uid`、`db`、`companyId`（若有設定）。
  **不回傳** server 的其他內部欄位。
- 專屬錯誤：`TRANSPORT_UNSUPPORTED`（見 §2.5）

### 4.4 `odoo_describe_model`

- 描述（en）：`List the queryable fields of one allow-listed Odoo model: name, type, label, relation, and selection values. Call this before building a domain for odoo_search_read.`
- 參數：`model`（enum，必填）
- RPC：`object.execute_kw(model, 'fields_get', [], { attributes: ['string','type','relation','selection','required','readonly'] })`
- 裁剪：
  - 只保留上述 6 個 attribute（原始 `fields_get` 每個欄位有 20+ 個 key）。
  - **排除** `type === 'binary'` 的欄位（不讓 agent 有機會去要 base64）。
  - `selection` 超過 30 個選項時截斷，該欄位名記入 `meta.truncatedFields`。
  - 欄位數上限 200，超過依欄位名字典序取前 200，`meta.truncated = true`、`meta.returned` 為實回筆數。
- 副作用：本次 `fields_get` 的 `name → type` 對應寫入欄位型別快取（§4.5）。
- 專屬錯誤：`MODEL_NOT_ALLOWED`

### 4.5 `odoo_search_read`

- 描述（en）：`Run a restricted search_read on one allow-listed Odoo model. Domain field names may not contain dots, so related-record conditions are not possible: query the related model first, then filter with ('field_id','in',[ids]). Only non-archived records are returned. When fields are omitted, a fixed default field set for that model is used.`
  （四語版本都必須含「不允許點號 → 先查 id 再用 in」與「只回未封存記錄」這兩句。）
- 參數：
  - `model`：enum（白名單），必填
  - `domain`：array，選填，預設 `[]`（見 §5.4）
  - `fields`：string[]，選填，1–30 個；省略時用 `DEFAULT_FIELDS[model]`
  - `limit`：integer，選填，預設 `config.defaultLimit`（20），上限 100
  - `offset`：integer，選填，預設 0，上限 10000
  - `order`：string，選填，格式 `field [asc|desc](, field [asc|desc])*`，最多 3 段，欄位名同樣不得含點號
- RPC：（首次查該 model 時）`fields_get` → `search_count`（取 `meta.total`）→ `search_read`

**欄位型別快取（blocker #3 / #5 定案）**

`OdooClient` 持有 `#fieldTypes: Map<model, Map<fieldName, type>>`，
**每個 model 在 plugin instance 生命週期內只打一次 `fields_get`**（`odoo_describe_model` 與
`odoo_search_read` 共用同一份快取）。`odoo_search_read` 用它做兩件事：

1. **欄位存在性**：`fields` / `domain` / `order` 用到的欄位若不在該 model 的 Map 中 → `INVALID_INPUT`，
   訊息列出該 model 前 N 個可用欄位（截斷至 200 字元，見 §6.2 的截斷規則；此訊息由本插件產生，
   不含上游自由文字，故不套 redaction）。
2. **binary 型別強制拒絕**：任何 `type === 'binary'` 的欄位一律拒絕，不論它叫什麼名字。
   `models.ts` 的 `BINARY_FIELDS`（`image_1920` / `image_1024` / `image_512` / `image_256` / `image_128` /
   `avatar_1920` / `avatar_128` / `datas` / `raw` / `db_datas`）保留為**快速路徑**，
   讓常見情況不必等 `fields_get`；真正的保證來自型別檢查。

**與「已砍掉的欄位降級機制」的區別（別誤讀成矛盾）**：v0.1 砍掉的是
「業務工具發現欄位不存在時**靜默移除**該條件並回 `meta.unsupportedFields`」——那種降級會讓錯誤的假設
表現成空結果。這裡保留的是「欄位不存在或型別為 binary 時**明確報錯**」。前者靜默、後者出聲，方向相反。

- 其餘裁剪：
  - **fields 未指定時絕不放行「全欄位」**——一律套 `DEFAULT_FIELDS`。這是 v0.1 最重要的一條裁剪規則。
  - 每個字串值超過 2000 字元 → 截斷並在尾端加 `…[truncated]`，欄位名記入 `meta.truncatedFields`
    （Odoo 的 `description` / `note` / `body_html` 常是幾十 KB 的 HTML）。
  - many2one 一律以 Odoo 原生 `[id, display_name]` 形式回傳，不展平（省 token）。
  - 最終仍受 `maxResponseBytes` 保護（傳輸層）。
- `active_test`：**不開放**這個 context 參數（§9 #6）。Odoo 預設只回 `active = true` 的記錄，
  工具描述已明說「只回未封存記錄」。因為預設 context 下 `active` 恆為 true，
  `DEFAULT_FIELDS` **不包含** `active` 欄位（省 token 且避免誤導）。
- 專屬錯誤：`MODEL_NOT_ALLOWED`、`INVALID_INPUT`、`ODOO_QUERY_ERROR`

### 4.6 `odoo_create_draft`（預設關閉）

- **只有 `config.allowWrite === true` 時才 `ctx.tools.register`。** 關閉時工具不存在。
- 描述（en）：`Create one draft record in Odoo. Only sale.order and project.task are allowed. A sale.order is always created with state=draft; a project.task may not specify state or stage_id and lands in the project's first stage.`
  （四語版本都必須包含這兩句草稿政策。）
- `presentCall`：`{ card: 'generic', title: messages.createDraftTitle, kind: 'edit' }`
- 參數：`model`（enum `['sale.order', 'project.task']`，必填）、`values`（object，必填）
- 允許欄位白名單（**其餘欄位一律 `INVALID_INPUT` 拒絕，不是靜默忽略**）：
  - `sale.order`：`partner_id`(必填, int)、`date_order`(date)、`client_order_ref`(str ≤ 100)、
    `note`(str ≤ 2000)、`user_id`(int)
  - `project.task`：`name`(必填, str ≤ 200)、`project_id`(必填, int)、`description`(str ≤ 2000)、
    `date_deadline`(date)、`partner_id`(int)、`user_ids`(int[] ≤ 10)
- 草稿強制（§1 硬邊界 3 的實作面）：
  - `sale.order`：送出前把 `state` 設為 `'draft'`；`values` 自帶 `state` → `INVALID_INPUT`。
  - `project.task`：`values` 自帶 `state` 或 `stage_id` → `INVALID_INPUT`；兩者都不送。
  - 一律**不接受** One2many 命令（`order_line`、`invoice_line_ids` 等）。
    `user_ids` 是唯一的多值欄位，送出時轉成 `[[6, 0, ids]]`。
- RPC：`object.execute_kw(model, 'create', [values], { context })`，接著 `read` 取回
  `sale.order` → `id, name, state`；`project.task` → `id, name, stage_id`，作為 `data`。
- 專屬錯誤：`MODEL_NOT_ALLOWED`、`INVALID_INPUT`、`ODOO_VALIDATION_ERROR`（Odoo 的 `UserError`/
  `ValidationError`，例如缺必填的 pricelist——**適用 G2 透出**）、`ODOO_QUERY_ERROR`、
  `WRITE_DISABLED`（client 層防線，見 §6.3）

---

## 5. Config schema

### 5.1 欄位表

| config 欄位 | 環境變數 fallback | 型別 | 預設 | 上下界 / 說明 |
| --- | --- | --- | --- | --- |
| `baseUrl` | `ODOO_URL` | string | `''` | http(s)、無內嵌帳密、無 query/fragment，尾端補 `/` |
| `db` | `ODOO_DB` | string | `''` | 1–100 字元 |
| `username` | `ODOO_USERNAME` | string | `''` | 1–200 字元 |
| `apiKey` | `ODOO_API_KEY` | string，`role('secret')` | `''` | 1–200 字元；建議用 Odoo API Key 而非密碼 |
| `companyId` | `ODOO_COMPANY_ID` | number | 未設定 | 正整數 ≤ 2^31-1；設定後所有呼叫帶 `context.allowed_company_ids: [id]`，並於 handshake 驗證（§2.4） |
| `allowWrite` | 無（刻意不吃 env） | boolean | `false` | `true` 才註冊 `odoo_create_draft` |
| `locale` | 無 | enum `en` / `zh-TW` / `zh-CN` / `ja` | `en` | **G1**：description / 參數 description / presentCall title 的語言；tool name 恆為英文 |
| `defaultLimit` | 無 | number | `20` | 1–100 |
| `requestTimeoutMs` | 無 | number | `30000` | 1 – 300000 |
| `maxResponseBytes` | 無 | number | `1000000`（1 MB） | 1 – 52428800（50 MiB） |

**plugin config 覆蓋環境變數**（`config.x?.trim() || env.X?.trim() || ''`），與 dsh-sonarqube 一致。
`allowWrite` 完全不吃 env，避免「環境裡不小心有個變數就開了寫入」。
`companyId` 由 `ODOO_COMPANY_ID` 讀入時以 `Number.parseInt(value, 10)` 解析，非正整數 → `INVALID_CONFIG`。

### 5.2 驗證時機（**blocker #6 定案**）

**兩段式**，刻意偏離 dsh-sonarqube 的「apply 期就要求憑證齊全」：

- **`apply` 期（載入 profile 時）只驗「填了就必須合法」的部分**：
  `baseUrl` 若非空則驗 URL 形狀（§5.3）；`requestTimeoutMs` / `maxResponseBytes` / `defaultLimit` /
  `companyId` 驗數值上下界；`locale` 驗 enum。違反 → `INVALID_CONFIG`（此時 throw 是對的，設定本身寫錯了）。
- **`baseUrl` / `db` / `username` / `apiKey` 缺漏不在 apply 期報錯**，延到第一次 handshake 才丟
  `INVALID_CONFIG`（訊息：`Set baseUrl/db/username/apiKey, or the ODOO_URL/ODOO_DB/ODOO_USERNAME/ODOO_API_KEY environment variables.`）。
  理由：使用者「裝了插件但還沒填設定」是正常中間狀態，不該讓整個 profile 載入失敗。

對應地，**`cordis.patch.yml` 只留 `id` 與 `name`**（比照 dsh-sonarqube），不預塞空字串 config；
欄位顯示與預設值交給 Schemastery 的 `.default()`。

`Config` schema 套 `.i18n(CONFIG_I18N)`，四語描述沿用 dsh-sonarqube 的做法，
key 覆蓋 `en` / `en-US` / `zh` / `zh-CN` / `zh-TW` / `ja` / `ja-JP`。

### 5.3 URL 驗證
沿用 dsh-sonarqube `normalizeBaseUrl`：`new URL()` 可解析、protocol ∈ {http:, https:}、
無 `username`/`password`、無 `search`/`hash`、pathname 尾端正規化為單一 `/`。違反 → `INVALID_CONFIG`。

### 5.4 Domain 驗證（安全關鍵）

**欄位名一律不得含點號（範圍變更 1）**。

原本允許最多兩層點號穿透（`partner_id.bank_ids.acc_number`）。雖然**回傳**欄位受 `DEFAULT_FIELDS`
限制，但 agent 可以用二分搜尋式的 domain（`ilike 'a%'` → `ilike 'b%'` …）
把**白名單外 model 的欄位值一位一位問出來**，形同一個 read oracle，
會讓 §3.2「白名單讓能力邊界一眼可見」的宣稱站不住。**因此收掉。**

需要關聯條件時，工具描述（四語）明確教 agent：先查關聯 model 取 id，再用 `('partner_id','in',[ids])`。

規則：
- 頂層是 array，長度 ≤ 40，葉節點（三元組）≤ 20
- 每個元素是 `'&' | '|' | '!'` 字串，或長度 3 的 array
- **前綴運算子 arity 驗證**（reviewer #8）：把 domain 當作一串前綴運算式做遞迴下降解析——
  `parseNode(i)`：`'&'`/`'|'` 消耗兩個子節點、`'!'` 消耗一個子節點、三元組消耗零個。
  自 index 0 起反覆 `parseNode` 直到陣列耗盡（Odoo 允許多個頂層節點隱含 AND）。
  任一 `parseNode` 越界（如 `['&', ('a','=',1)]` 少一個運算元） → `INVALID_INPUT`，
  訊息指出缺少運算元的索引位置。
- 三元組 `[field, operator, value]`：
  - `field`：`/^[a-z_][a-z0-9_]*$/`（**不含點號**），且必須存在於該 model 的欄位型別快取（§4.5）
  - `operator` ∈ `= != > >= < <= like not like ilike not ilike in not in child_of parent_of =like =ilike`
  - `value`：string（≤ 200）/ number / boolean / null，或上述的陣列（≤ 100 個元素）；**不接受巢狀物件**
- 任何違反 → `INVALID_INPUT`，訊息只說明違反哪一條規則與出問題的索引位置，
  **不回顯 domain 的 value**（避免把 PII 打進 log）

### 5.5 分頁上界
`limit` ≤ 100、`offset` ≤ 10000，**且 `offset + limit` ≤ 10000**（`MAX_SEARCH_RESULTS`）。
乘積/總和檢查比照 dsh-sonarqube `appendPagination` 的 `page * pageSize ≤ 10000`，
避免 `offset=10000&limit=100` 讓 Odoo 掃到第 10100 筆。違反 → `INVALID_INPUT`。

---

## 6. 錯誤處理

### 6.1 錯誤碼清單

`OdooApiError`：`message` + `code` + 選填 `status` / `model` / `odooException` / `retryAfter` / `detail`。
`toJSON()` 只吐這些安全欄位，**永不夾帶 apiKey 或原始 response body**。

| # | code | 觸發情境 | G2 透出 |
| --- | --- | --- | --- |
| 1 | `INVALID_CONFIG` | baseUrl/db/username/apiKey 缺漏或不合法、數值超界、`companyId` 不在使用者的 company_ids | 否 |
| 2 | `INVALID_INPUT` | **本插件自己驗出**的參數問題：domain 規則、arity、欄位不存在、binary 欄位、order、分頁上界、`values` 欄位不允許 | 不適用（訊息本來就是自己寫的） |
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
| 15 | `ODOO_QUERY_ERROR` | `builtins.ValueError` / `builtins.KeyError`——Odoo 對「欄位名打錯、operator 不合法、domain 結構錯」的表達 | **是** |
| 16 | `MODEL_NOT_ALLOWED` | 請求的 model 不在白名單（enum 已擋一層，此為 client 防線） | 否 |
| 17 | `WRITE_DISABLED` | client 的 create 在 `allowWrite=false` 的 client 上被呼叫（見 §6.3） | 否 |
| 18 | `TRANSPORT_UNSUPPORTED` | `/jsonrpc` 404/405/重導/非 JSON/非 JSON-RPC（見 §2.5） | 否 |
| 19 | `ODOO_HTTP_ERROR` | 其餘非 2xx 的保底；**HTTP 400 亦落此碼** | **是**（僅 400） |

Odoo exception 名稱 → code 的對應表寫在 `errors.ts` 常數，**由 `error.data.name` 精確比對**，
不做字串模糊比對（Odoo 錯誤訊息會被 i18n，模糊比對必壞）。
`error.data.name` 缺失或不在對應表 → `ODOO_RPC_ERROR`。

### 6.2 G2 — 使用者輸入錯誤的訊息透出

**與 dsh-sonarqube「錯誤訊息永不夾帶上游 body」的既有慣例不同，此處為刻意例外，
理由是 query / domain / values 語法錯誤若不回饋，agent 只能盲猜。**

適用範圍（**只有這三種，其餘一律靜態訊息**）：

1. HTTP `400`（`ODOO_HTTP_ERROR`）
2. `error.data.name` ∈ `{odoo.exceptions.UserError, odoo.exceptions.ValidationError}`（`ODOO_VALIDATION_ERROR`）
   —— Odoo 對「輸入不合業務規則」的正規表達
3. `error.data.name` ∈ `{builtins.ValueError, builtins.KeyError}`（`ODOO_QUERY_ERROR`）
   —— Odoo 對「欄位名打錯 / operator 不合法 / domain 結構錯」的表達，
   典型訊息 `Invalid field 'xxx' on model 'sale.order'`。
   **這一類才是 G2 的主要目標**：唯讀工具遇到的輸入錯誤幾乎都落在這裡；
   若只把 UserError/ValidationError 當 HTTP 400 的等價物，G2 對唯讀工具幾乎不會觸發，設計目的落空。

取值來源（**只取結構化欄位，不得整包丟 response body**）：
- JSON-RPC：`error.data.message`（string）；缺則 `error.message`；再缺則不透出
- 純 HTTP 400：body 若為 JSON 且有 `error.data.message` / `error.message` 則取之；否則不透出

淨化管線 `sanitizeDetail(raw): string | undefined`（`errors.ts`），**順序固定為「先 redact 再截斷」**：
1. 非 string → `undefined`
2. 正規化空白：換行與控制字元併為單一空格、`trim()`
3. **redaction — 將「命中的子字串」替換為 `[redacted]`**（不是整段丟棄）：
   - 目前設定的 `apiKey` 值（完全比對子字串）
   - `/(?:api[_-]?key|token|password|secret|authorization|bearer)\s*[:=]\s*\S+/gi`
   - 長度 ≥ 20 的連續 `[A-Za-z0-9_\-]` 字串（Odoo API key 形狀）
4. **截斷至 200 字元**（超過取前 197 + `...`）。
   因為順序是先 redact，任何被截斷點切開的殘段都已經是 redact 後的文字，
   **不可能出現「一半的密鑰因截斷而逃過 redaction」**。
5. 結果為空字串 → `undefined`

放置位置：`OdooApiError.detail`，並串接進 `message`：`"<靜態英文訊息> Odoo said: <detail>"`。
`detail` 為 `undefined` 時 `message` 就只有靜態訊息。

§4.5 那條「欄位不存在時列出可用欄位」的訊息由本插件產生、不含上游自由文字，
因此**只套第 4 步的 200 字元截斷，不套 redaction**。

### 6.3 `WRITE_DISABLED` 的定位（reviewer #12）

`allowWrite=false` 時工具未註冊，正常路徑不可達。但 `OdooClient` 是 export 的公開 API
（比照 dsh-sonarqube export `SonarQubeClient`），使用者可能直接呼叫 `client.createDraft()`。
因此**保留這個防線**，並在 `tests/client.test.ts` 直接對 client 呼叫 create 來覆蓋該分支
（避免 80% branches 門檻被一個不可達分支拖累）。

---

## 7. 檔案結構與職責

```
dsh-odoo/
├── src/
│   ├── index.ts        Cordis 入口：name / inject / Config schema（含 locale）/ apply（單一 client + allowWrite 分支）
│   ├── config.ts       config 解析 + 兩段式驗證 + 上下界常數
│   ├── errors.ts       OdooApiError + 19 個 code + HTTP/Odoo exception 對應 + sanitizeDetail（G2）
│   ├── rpc.ts          JSON-RPC 傳輸：fetch、timeout、bounded body、JSON-RPC error 解包、redirect: manual
│   ├── client.ts       handshake/uid/companyId 驗證、欄位型別快取、search_read、fields_get、create、裁剪
│   ├── models.ts       14 個 model 白名單、DEFAULT_FIELDS、BINARY_FIELDS 快速路徑、create 允許欄位表
│   ├── domain.ts       domain（含 arity）/ fields / order / 分頁 / 日期 驗證
│   ├── tools.ts        createOdooTools(client, locale, allowWrite) → 3 或 4 個工具定義
│   ├── locales.ts      G1：CONFIG_I18N + OdooMessages 四語（4 個工具描述、1 個 title、參數說明）
│   └── types.ts        JsonValue / ApiResult / 參數型別
├── tests/              vitest（見 §8）
├── scripts/smoke-odoo.sh   手動 live 驗證腳本（不進 CI，見 §9）
├── .github/workflows/  ci.yml、release.yml
├── cordis.patch.yml    只有 id + name（見 §5.2）
├── README.md / README.zh-TW.md / README.zh-CN.md / README.ja.md
├── LICENSE（MIT）
├── package.json、tsconfig.json、tsconfig.build.json、biome.json、vitest.config.ts
```

`index.ts` 的 `apply`：

```
apply(ctx, config):
  client = createOdooClient(config)            // 單一實例，eager，見 §2.4
  for tool of createOdooTools(client, config.locale, config.allowWrite):
      ctx.tools.register(tool)
```

### 預估行數（已依 4 工具範圍重算）

| 檔案 | 行數 | 說明 |
| --- | --- | --- |
| `index.ts` | ~95 | Schema（10 欄）+ 單一 client + allowWrite 分支 |
| `config.ts` | ~150 | 兩段式驗證 |
| `errors.ts` | ~200 | 19 個 code + exception 對應 + sanitizeDetail |
| `rpc.ts` | ~200 | timeout/abort/bounded body/JSON-RPC error 解包/redirect manual |
| `client.ts` | ~230 | handshake + companyId 驗證 + 欄位型別快取 + search_read/describe/create + 裁剪 |
| `models.ts` | ~100 | 純常數表 |
| `domain.ts` | ~150 | 含 arity 遞迴下降解析 |
| `tools.ts` | ~160 | 4 個工具，描述全走 messages |
| `locales.ts` | ~210 | 四語 × (config 10 欄 + 4 工具描述 + 1 title + ~12 參數說明) |
| `types.ts` | ~60 | |
| **合計** | **~1555** | 收斂前估 ~1900；砍掉 4 個業務工具與降級機制後下降，但 arity 驗證與型別快取補回一部分 |

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
- `@deepseek-ai/*` 一律放 `peerDependencies`，範圍**必須顯式列出 prerelease 分支**
  （`^0.1.0-rc.8 || ^0.1.1-rc.2`）。只寫 `^0.1.0-rc.8` 會被 node-semver 靜默排除 `0.1.1-rc.2`，
  使用者安裝直接 ERESOLVE——dsh-sonarqube 實際踩過。
- `files` 必須含 `lib`、`cordis.patch.yml`、四份 README、`LICENSE`。
- GitHub repo topics：`dsh-plugin` + `odoo`。

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
與 Node 22.19 / 24 雙版本 runtime 匯入測試。**套件改名為 `@maxhsu/dsh-odoo` 時，
smoke test 的 grep 字串與此處的 tarball 檔名要一起改。**

---

## 8. 測試策略（vitest，mock fetch）

不打真的 Odoo。所有測試注入假的 `FetchImplementation`（與 dsh-sonarqube 的 client 建構子相同做法）。

| 檔案 | 覆蓋 |
| --- | --- |
| `tests/config.test.ts` | env vs config 優先序、`allowWrite` 不吃 env、URL 拒絕（ftp、含帳密、含 query/fragment）、數值上下界、`ODOO_COMPANY_ID` 非整數；**兩段式驗證**：缺 db/username/apiKey 時 `apply` 不 throw、第一次工具呼叫才丟 `INVALID_CONFIG` |
| `tests/domain.test.ts` | **含點號的欄位名一律拒絕**（`partner_id.name`）、**arity 不足**（`['&', triple]`）、合法的巢狀 `&`/`|`/`!`、頂層多節點隱含 AND、operator 白名單、value 型別與長度、葉節點與長度上限、`offset + limit > 10000`、order 格式與點號、錯誤訊息不含 domain value |
| `tests/rpc.test.ts` | **HTTP 200 + `error` body 必須拋錯**（最重要）、`/jsonrpc` 404/405/302/HTML/非 JSON-RPC 五條 `TRANSPORT_UNSUPPORTED` 路徑、各 Odoo exception → code 對應（含 `builtins.ValueError`/`KeyError` → `ODOO_QUERY_ERROR`）、超過 maxResponseBytes（content-length 與串流兩路）、timeout、caller abort、429 `retryAfter`、5xx |
| `tests/errors.test.ts` | **G2**：400 / UserError / ValidationError / ValueError / KeyError 五者帶 `detail`；401/403/404/500/TRANSPORT_UNSUPPORTED 一律無 `detail`；`sanitizeDetail` **先 redact 再截斷**（構造一個「密鑰恰好跨越 200 字元邊界」的案例，斷言輸出不含密鑰片段）、命中處替換為 `[redacted]` 而非整段丟棄、apiKey 原值被 redact、`token=xxx` 形式被 redact、長 base62 字串被 redact、非 string 回 `undefined` |
| `tests/client.test.ts` | `authenticate` 回 `false` → `AUTHENTICATION_FAILED`；**handshake 只做一次**（第二次工具呼叫不重打 authenticate），失敗後清空可重試；`companyId` 不在 `company_ids` → `INVALID_CONFIG`，在其中則 context 帶 `allowed_company_ids`；**欄位型別快取每 model 只打一次 `fields_get`**，`describe_model` 與 `search_read` 共用；欄位不存在 → `INVALID_INPUT` 且訊息列出可用欄位並截斷至 200 字元；`type === 'binary'` 欄位即使不在 `BINARY_FIELDS` 也被拒絕；fields 省略時送出的 `fields` 等於 `DEFAULT_FIELDS`；字串截斷與 `meta.truncatedFields`；**`allowWrite=false` 的 client 直接呼叫 create → `WRITE_DISABLED`** |
| `tests/tools.test.ts` | `model` enum 拒絕白名單外的值；`create_draft` 的 values 白名單、`sale.order` 強制 `state='draft'`、`project.task` 帶 `state` 或 `stage_id` → `INVALID_INPUT`、`user_ids` 轉 `[[6,0,ids]]`；`meta` 只出現 §4.1 契約表列的 key；全部工具 `isConcurrencySafe() === true`；**只有 `odoo_create_draft` 有 `presentCall` 且 `kind === 'edit'`** |
| `tests/locales.test.ts` | **G1**：四種 locale 各建一次工具，tool **name 完全相同且為英文**；`description` 四語互不相同且皆非空；每個參數都有該 locale 的 description；`odoo_create_draft` 的四語描述都含草稿政策兩句；`odoo_search_read` 的四語描述都含「不允許點號 → 先查 id 再用 in」與「只回未封存記錄」；`createDraftTitle` 四語皆非空 |
| `tests/plugin.test.ts` | `name`/`inject`/`Config` 存在；`Config` 四語 i18n 描述；**`allowWrite=false` 註冊 3 個工具、`allowWrite=true` 註冊 4 個且含 `odoo_create_draft`**；`locale` 預設 `en` |

覆蓋率門檻比照 dsh-sonarqube：branches/functions/lines/statements 各 80%，`src/types.ts` 排除。

---

## 9. Live 驗證計畫（**已於 2026-08-27 驗證於 Odoo 18**）

> **狀態更新（2026-08-27）**：已對官方 `odoo:18` image（`server_version` `18.0-20260817`）
> 完成 live verification。下表每一列都補上了驗證狀態；完整實測記錄、政策邊界實測結果、
> 以及**仍未驗證的範圍**（只驗 Odoo 18、只驗直連 Docker image、多公司只驗錯誤路徑）
> 見 [`docs/live-verification.md`](../../live-verification.md)。
> 該次驗證另外發現一項本節原本沒有的問題：**白名單的 14 個 model 不保證存在**，
> 取決於該 Odoo 安裝了哪些業務模組。

v0.1 的所有相容性假設一律採保守寫法，README 原本標示「尚未對真實 Odoo 做過 live 驗證」，
現已更新為「驗證於 Odoo 18，日期 2026-08-27」並保留未驗範圍的說明。

`scripts/smoke-odoo.sh`（手動執行，不進 CI）依序跑：`odoo_server_info` →
`odoo_describe_model('res.partner')` → `odoo_search_read('res.partner')` →
`odoo_search_read('sale.order')` →（`allowWrite=true` 時）`odoo_create_draft`。

### 第一次接到真實 Odoo 時必須驗證的假設清單

| # | 假設 | 驗證狀態（2026-08-27, Odoo 18） | 若不成立的回退方案 |
| --- | --- | --- | --- |
| 1 | `/jsonrpc` 存在且接受 `service: common/object` | ✅ 成立（官方 image 開箱即用，handshake 兩步通過） | 已有 `TRANSPORT_UNSUPPORTED` 明確錯誤；若普遍不成立才開 0.2 做 XML-RPC |
| 2 | JSON-RPC 錯誤時 HTTP 為 200、錯誤在 `error.data.name` / `error.data.message` | ✅ 成立（兩條錯誤路徑皆照此形狀回） | HTTP 分支已先接住；補測試案例即可 |
| 3 | Odoo API Key 可直接當 `authenticate` 的 password 使用 | ⬜ 未驗證（未載明所用為 key 或密碼） | 回退成要求使用者填真實密碼，README 加註 |
| 4 | db 名錯誤時訊息可辨識（§2.5 最後一列） | ⬜ 未驗證（未刻意填錯 db 名） | 移除該列特判，一律回 `AUTHENTICATION_FAILED` |
| 5 | 欄位名打錯時 `error.data.name` 是 `builtins.ValueError` 或 `builtins.KeyError` | ⬜ 未驗證（客戶端先擋，此路徑幾乎不可達） | 若是別的 exception 名稱，把它加進 §6.2 的 G2 白名單與 `ODOO_QUERY_ERROR` 對應表 |
| 6 | **`active_test` 隱含過濾**：search/search_read 預設只回 `active = true` 的記錄 | ✅ 成立（預設 39／`active_test:false` 43／domain 寫 `active` 撈到 4 筆封存記錄——證實 domain 擋 `active` 是必要防線） | 若成立（預期成立）：維持不開放該 context，工具描述已明說「只回未封存記錄」，`DEFAULT_FIELDS` 不含 `active`。若不成立（某版本預設回全部）：`DEFAULT_FIELDS` 補回 `active` 並修正工具描述 |
| 7 | **`allowed_company_ids` 的實際效果**：只在有多公司 record rule 的 model 上生效，對 `res.users` / `product.template` 未必過濾 | 🟡 錯誤路徑成立（無權 company → `Access to unauthorized or invalid companies.`）；合法 companyId 的過濾效果未驗 | handshake 已驗 `companyId ∈ company_ids`（§2.4），避免誤導成 `PERMISSION_DENIED`。若實測發現對某些 model 完全無效，README 明寫「companyId 只影響有多公司規則的 model」，不擴大實作 |
| 8 | model 不存在（模組未安裝）時的 `error.data.name` 值 | ✅ 已測得：`odoo.exceptions.UserError` + `"Object sale.order doesn't exist"`。**結論是無專屬名稱**，UserError 過於泛用，依本列原訂條件不新增專屬錯誤碼 | 目前保守歸類為 `ODOO_RPC_ERROR`；實測後若有穩定 exception 名稱，再對應成 `NOT_FOUND` 並在訊息提示「模組未安裝」 |
| 9 | `fields_get` 的 `attributes` 參數受支援 | ✅ 成立（`res.partner` 186 欄位，只回要求的 attribute）。放寬 byte 上限的回退在 18 上不觸發，但保留給 8–17 | **不是 no-op 回退**：改用最小 attribute 集 `fields_get([], ['type'])`；若連 `attributes` 都不支援，該次 `fields_get` 請求**單獨**把 byte 上限放寬到 `max(maxResponseBytes, 8 MB)`。原因：完整 `fields_get`（`account.move` / `res.partner`）輕易超過 1 MB 預設值，而欄位型別快取是所有工具的前置步驟——不放寬會讓**每個工具一起壞成 `RESPONSE_TOO_LARGE`** |
| 10 | 建立 `project.task` 不指定 `stage_id` 時會落在第一個階段 | ✅ 成立（落在 `[1, "New"]`，seq 最小）。四語描述仍維持保守寫法「由 Odoo 套用預設階段」 | 若落在別處，改為先查該 project 的最小 sequence stage 再顯式帶入 |
| 11 | `sale.order` 只給 `partner_id` 即可建立（pricelist/company 由 onchange 補上） | ✅ 成立（建立成功，回 `{id, name, state:'draft'}`） | 若 Odoo 丟 `UserError`（缺 pricelist），G2 已會把原因透出；必要時把 `pricelist_id` 加進 create 允許欄位 |
| 12 | 各業務欄位的存在性與 selection 值域（本列為驗證後補記，原屬 §10.1 的非目標理由） | ✅ 全部符合（`sale.order.state` 含 `draft`；`project.task.state` 確實無 `draft`；`account.move.payment_state` 七個值；`customer_rank`/`supplier_rank` 存在） | 維持不做業務包裝工具、不做欄位存在性的靜默降級 |
| 13 | **白名單 model 在目標 Odoo 上存在**（驗證時新發現，設計階段未列） | ❌ **不成立**：剛裝好的 Odoo 只有 `base` 系列 model；其餘 12 個需 `product`/`sale`/`purchase`/`account`/`project`/`crm`/`stock` 模組 | 不新增錯誤碼（判別依據只有會被翻譯的訊息文字）；改為在 `odoo_search_read` 與 `odoo_describe_model` 的四語描述與四語 README 明說，並引導先用 `odoo_describe_model` 確認 |

---

## 10. 非目標（v0.1 明確不做）

1. **不做業務包裝工具**（`odoo_list_partners` / `odoo_list_sale_orders` / `odoo_list_project_tasks` /
   `odoo_list_invoices`）——**延到 0.2，等有可實測的 Odoo 實例之後**。理由：它們的正確性完全依賴
   未經實測的欄位假設（`customer_rank` 是否存在、`project.task.state` 的值域、
   `account.move.payment_state` 的 selection、日期欄位是 date 還是 datetime），
   而**假設錯了不會報錯、只會靜默回空結果**，是對 agent 最糟的失敗模式。
   v0.1 用 `odoo_describe_model` + `odoo_search_read` 覆蓋同樣的查詢需求，且錯誤會明確出聲。
2. **不做欄位存在性的靜默降級**（原規劃的 `meta.unsupportedFields`）——理由同上，靜默降級會掩蓋錯誤假設。
   欄位不存在一律 `INVALID_INPUT`（§4.5）。
3. **不做關聯穿透查詢**：domain 欄位名不得含點號（§5.4）。這同時是安全邊界，不只是簡化。
4. **不做任何更新/刪除**：無 `write`、`unlink`、`copy`、workflow 動作（`action_confirm`、`action_post` 等）。
5. **不做 One2many 明細建立**：`odoo_create_draft` 不接受 `order_line` / subtask。
6. **不主動回傳 binary 欄位**：`DEFAULT_FIELDS` 不含任何 binary 欄位，且明確拒絕請求
   `type === 'binary'` 的欄位（§4.5）。
   **精確宣稱**：這擋的是 Odoo 型別系統標記為 `binary` 的欄位；若有人把 base64 塞進 `char`/`text` 欄位，
   本插件無從辨識——那種內容會受 2000 字元截斷，但不會被拒絕。不做「保證絕不出現 base64」這種擋不住的承諾。
7. **不讀寫 `ir.attachment`**。
8. **不做 XML-RPC 傳輸**（§2.3），也不做 `/web/dataset/call_kw` session 路徑。
9. **不做 model 探索**：沒有「列出這台 Odoo 有哪些 model」的工具；白名單是原始碼常數，不可由 config 擴充。
10. **不做 report/PDF 產生**、不做 `render_qweb_pdf`。
11. **不做多資料庫切換**：一個 plugin instance 綁一個 `db`。
12. **不做 cursor 分頁或自動翻頁**：只有 `limit`/`offset`，`meta.total` 讓 agent 自己決定要不要再翻。
13. **不開放 `active_test`**：只查未封存記錄。
14. **不做 webhook / 即時通知**。
15. **不做寫入的稽核 log 落地**（v0.1 只在回應裡帶回建立的 id）。
16. **不做 `config.transport` 可配置**（只有 JSON-RPC 一種）。
17. **不做錯誤訊息的 i18n**（G1 豁免，§1）。

---

## 11. 白名單（`models.ts`）

`odoo_search_read` 與 `odoo_describe_model` 的 `model` enum，共 14 個。
`DEFAULT_FIELDS` 是 `search_read` 未指定 `fields` 時的預設欄位集（**不含 `active`**，理由見 §4.5）。

| model | 用途 | DEFAULT_FIELDS |
| --- | --- | --- |
| `res.partner` | 客戶/供應商/聯絡人 | id, name, display_name, email, phone, is_company, parent_id, city, country_id, vat |
| `res.users` | 使用者（業務員） | id, name, login |
| `res.company` | 公司 | id, name, currency_id |
| `product.product` | 產品變體 | id, name, default_code, list_price, uom_id, type |
| `product.template` | 產品範本 | id, name, default_code, list_price, categ_id, type |
| `sale.order` | 報價/訂單 | id, name, partner_id, date_order, state, amount_untaxed, amount_total, currency_id, user_id, client_order_ref |
| `sale.order.line` | 訂單明細 | id, order_id, product_id, name, product_uom_qty, price_unit, price_subtotal |
| `purchase.order` | 採購單 | id, name, partner_id, date_order, state, amount_total, currency_id |
| `account.move` | 發票/帳單 | id, name, partner_id, move_type, invoice_date, invoice_date_due, state, payment_state, amount_untaxed, amount_total, amount_residual, currency_id |
| `account.move.line` | 發票明細 | id, move_id, name, account_id, debit, credit, balance |
| `project.project` | 專案 | id, name, partner_id, user_id |
| `project.task` | 任務 | id, name, project_id, stage_id, user_ids, date_deadline, priority, partner_id, write_date |
| `crm.lead` | 商機 | id, name, partner_id, stage_id, expected_revenue, probability, user_id, date_deadline |
| `stock.quant` | 庫存量 | id, product_id, location_id, quantity, available_quantity, lot_id |

都是標準 Odoo CE model。模組未安裝的實例，其錯誤歸類見 §9 假設 #8。
`DEFAULT_FIELDS` 只影響「未指定 fields 時送什麼」；欄位是否真的存在，由 §4.5 的型別快取在請求時驗證，
不存在則 `INVALID_INPUT`（例如 Odoo 17 以前的 `project.task` 沒有某些欄位時，會明確報錯而非靜默略過）。

---

## 12. 決策紀錄

### 全域慣例
- **已定：G1 — runtime tool metadata 四語走 `config.locale`（照 dsh-forge 的 `createXxxTools(client, locale)`）**
  —— tool name 固定英文、description / 參數 description / presentCall title 依 locale 切換，硬性要求；
  **錯誤訊息豁免，一律英文靜態**。
- **已定：G2 — 錯誤訊息「過濾後透出，僅限使用者輸入類錯誤」**
  —— HTTP 400、Odoo `UserError`/`ValidationError`、以及 `builtins.ValueError`/`KeyError` 三類透出
  `error.data.message`，先 redact 再截斷至 200 字元；刻意偏離 dsh-sonarqube 的慣例，
  理由是 query/domain/values 語法錯誤若不回饋，agent 只能盲猜。詳見 §6.2。

### 範圍
- **已定：v0.1 收斂為 4 個工具**（`odoo_server_info` / `odoo_describe_model` / `odoo_search_read` /
  `odoo_create_draft`），砍掉 4 個業務包裝工具與整套欄位存在性降級機制
  —— 沒有可實測的 Odoo，業務工具的欄位假設錯了會靜默回空結果；改用「明確報錯」取代「靜默降級」。
  model 白名單與 `DEFAULT_FIELDS` 保留。
- **已定：domain 欄位名不得含任何點號** —— 點號穿透可被當成對白名單外 model 的 read oracle
  （二分搜尋式 `ilike`），會讓白名單的能力邊界宣稱失效。關聯查詢改教 agent「先查 id 再用 `in`」。

### 個別
- **已定：D1 傳輸層 — 只做 JSON-RPC `/jsonrpc`** —— 零 runtime 依賴且與骨架同形，相容性缺口可偵測、可明說（§2.5）。
- **已定：D2 工具形狀 — 受限通用（`model` 為 enum + 不允許點號 + 強制預設欄位）** —— 受限性在 schema 上就看得見，描述與程式碼可對照。
- **已定：D3 白名單 — 固定在原始碼，不可由 config 擴充** —— 保持描述與審核結論可預測。
- **已定：D4 多公司 — 只有 config 層單值 `companyId`，工具不提供 company 參數**，並於 handshake 驗證其有效性 —— 多公司是部署層設定；先驗可避免誤導性的 `PERMISSION_DENIED`。
- **已定：D5 `project.task` 草稿定義 — 禁止指定 `state` 與 `stage_id`，落在專案第一個階段** —— Odoo 此 model 沒有 `draft` state；`sale.order` 仍強制 `state='draft'`。兩條政策都寫進四語工具描述。
- **已定：D6 字串截斷 — 單一字串值上限 2000 字元 + `maxResponseBytes` 預設 1 MB** —— 只靠 byte 上限會讓正常查詢整個失敗。
- **已定：D7 筆數 — `defaultLimit` 預設 20（config 可調 1–100）、`limit` ≤ 100、`offset` ≤ 10000 且 `offset + limit` ≤ 10000** —— 總和檢查比照 dsh-sonarqube 的 `page * pageSize` 上界。
- **已定：D8 `stock.quant` / `crm.lead` — 留在唯讀白名單**（本來就沒有專屬工具了）。
- **已定：client 生命週期 — `apply` 建立單一 eager client**（sonarqube 式），不用 dsh-forge 的 per-call factory —— 否則 handshake 與欄位型別快取每次呼叫都重建。
- **已定：`presentCall` — 只有 `odoo_create_draft` 做，`kind: 'edit'`** —— `ToolCallKind` 沒有 `'write'`；唯讀呼叫沒有需要事前辨識的風險。
- **已定：config 驗證兩段式 — `apply` 只驗「填了就要合法」，憑證缺漏延到 handshake** —— 「裝了但還沒填設定」不該讓 profile 載入失敗；`cordis.patch.yml` 因此比照 sonarqube 只留 id/name。
- **已定：`WRITE_DISABLED` 保留**，由 `tests/client.test.ts` 直接呼叫 client 覆蓋該分支。
