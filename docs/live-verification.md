# Live verification 結果

## 現況：已驗證於 Odoo 18

**`dsh-odoo` 已於 2026-08-27 對真實 Odoo 18 實例完成 live verification。**

先前版本的本文件記載「尚未對任何真實 Odoo 執行過驗證」，該狀態已作廢。

### 測試環境

| 項目 | 值 |
| --- | --- |
| Odoo image | 官方 `odoo:18` |
| `server_version` | `18.0-20260817` |
| `server_serie` | `18.0` |
| `protocol_version` | `1` |
| 資料庫 | postgres:16-alpine，db 名 `dshtest`，**含 demo data** |
| 額外安裝模組 | `sale_management` / `project` / `account` / `crm` / `stock` / `purchase` |
| 認證 | `common.authenticate` → uid = 2 |
| 日期 | 2026-08-27 |

### 這次驗證抓到什麼

一個**設計階段沒人想到**的問題：白名單的 14 個 model **在剛裝好的 Odoo 上只有 2 個存在**
（見下方〈最重要的發現〉）。這不是程式碼 bug，是能力邊界宣稱與真實部署之間的落差，
mock 測試永遠測不到——因為 mock 的 Odoo 一定「什麼 model 都有」。

作為對照：Sentry 那次 live verification 抓到一個**經過三輪 code review 都沒被發現的真 bug**
（short id 裡含連字號的 project slug 被輸入驗證誤拒）。三個 reviewer 讀同一份程式碼都認為
那段 regex 是對的，只有真實資料證明它不對。「mock 測試全綠」與「對真實系統可用」始終是兩件事。

---

## 最重要的發現：白名單 model 不保證存在

**剛裝好、未安裝業務模組的 Odoo，14 個白名單 model 只有 2 個存在。**

其餘 12 個由業務模組提供，而那些模組**不是預設安裝**的：

| 提供模組 | 白名單 model | 預設安裝 |
| --- | --- | --- |
| `base` | `res.partner`、`res.users`、`res.company` | 是 |
| `product` | `product.product`、`product.template` | 否 |
| `sale` / `sale_management` | `sale.order`、`sale.order.line` | 否 |
| `purchase` | `purchase.order` | 否 |
| `account` | `account.move`、`account.move.line` | 否 |
| `project` | `project.project`、`project.task` | 否 |
| `crm` | `crm.lead` | 否 |
| `stock` | `stock.quant` | 否 |

未安裝時，`odoo_search_read('sale.order')` 的實際錯誤是：

```
ODOO_VALIDATION_ERROR / odoo.exceptions.UserError
detail: "Object sale.order doesn't exist"
```

> **一處待複核**：本次實測記錄為「只有 `res.partner` 與 `res.users` 存在」，但 `res.company`
> 同樣由 `base` 提供，理論上任何 Odoo 都有。這一列的量測值與預期不符，下次接觸實例時值得重跑
> 確認；上表的模組歸屬欄位則是依 Odoo 標準模組結構填寫。

### 為什麼沒有為此新增 `MODEL_NOT_INSTALLED` 錯誤碼

評估後**決定不改程式碼**，理由如下：

1. **唯一的判別依據是會被翻譯的訊息文字。** 實測顯示 `error.data.name` 是
   `odoo.exceptions.UserError`——這是 Odoo 最泛用的例外，數百種情境共用，**無法當判別依據**。
   真正帶資訊的是 `"Object sale.order doesn't exist"` 這串訊息，而 Odoo 的錯誤訊息會隨使用者
   語系翻譯。對它做字串比對等於引入一條**新的、未驗證的假設**——正是這整份文件在消滅的東西。
   spec §9 假設 #8 當初就先講明：只有在「有穩定的 exception 名稱」時才對應成專屬錯誤碼；
   實測結果是**沒有**，所以按原訂條件不做。
2. **真正的原因已經原封不動送到 agent 手上。** `ODOO_VALIDATION_ERROR` 在 G2 的 detail 白名單裡，
   agent 收到的是 `Odoo rejected the values. Odoo said: Object sale.order doesn't exist`。
   自創一個錯誤碼並不會比 Odoo 自己講的更準確。
3. **主動探測的代價不成比例。** 要事先知道 model 存不存在，得查 `ir.model`，這需要把 `ir.model`
   加進讀取白名單（擴大讀取面）並為每次呼叫多付一趟 RPC，只為了解決一個「部署當下一次性」的問題。
4. **這本質上是文件問題，不是錯誤處理問題。** agent 之所以困惑，是因為它看到 model 在 enum 白名單裡
   就推論「一定能用」。修正點應該落在**它每次都會讀到的工具描述**，而不是它失敗之後才看到的錯誤碼。

因此改為（已於 commit `f4021c4` 落地）：`odoo_search_read` 與 `odoo_describe_model` 的**四語工具描述**
明說「白名單 model 僅在該 Odoo 安裝了對應模組時才存在」，並引導先用 `odoo_describe_model` 確認；
四語 README 同步加註。

**已知殘留的不精確**：`ODOO_VALIDATION_ERROR` 的固定前綴是 `Odoo rejected the values.`，
但唯讀工具根本沒有 values。要修得區分讀寫情境，屬於錯誤訊息分類的改動，不在本次範圍，記為後續項目。

---

## spec §9 假設清單：逐項驗證狀態

| # | 假設 | 狀態 | 實測結果 / 未驗原因 |
| --- | --- | --- | --- |
| 1 | `/jsonrpc` 存在且接受 `service: common/object` | ✅ **成立** | 官方 image 開箱即用。`{"service":"db","method":"list"}` 回合法 JSON-RPC 2.0；handshake 兩步皆通過（`common.version` → `18.0-20260817`，`common.authenticate` → uid=2） |
| 2 | JSON-RPC 錯誤時 HTTP 為 200、錯誤在 `error.data.name` / `error.data.message` | ✅ **成立** | 兩條錯誤路徑都照此形狀回：model 不存在 → `odoo.exceptions.UserError` + `"Object sale.order doesn't exist"`；無權 company → `"Access to unauthorized or invalid companies."` |
| 3 | Odoo API Key 可直接當 `authenticate` 的 password 使用 | ⬜ **未驗證** | handshake 成功只證明 `authenticate` 可用；本次記錄未載明所用的是 API key 還是登入密碼，因此這條不算驗過。回退方案維持：不成立就要求填真實密碼 |
| 4 | db 名錯誤時訊息可辨識 | ⬜ **未驗證** | 本次未刻意填錯 db 名。回退方案維持：移除該列特判，一律回 `AUTHENTICATION_FAILED` |
| 5 | 欄位名打錯時 `error.data.name` 是 `builtins.ValueError` / `builtins.KeyError` | ⬜ **未驗證** | 未測。且插件會先用 `fields_get` 的快取在**客戶端**擋掉未知欄位（回 `INVALID_INPUT`），這條 Odoo 路徑在正常使用下幾乎不可達 |
| 6 | **`active_test` 隱含過濾**：預設只回 `active = true` | ✅ **成立**（並證實 domain 防線必要） | 同一 model：預設 `search_count` = 39；`context:{active_test:false}` = 43；domain 明寫 `[('active','=',false)]` = **4（真的撈得到封存記錄）**。→ 預設確實隱含過濾，但 agent 只要在 domain 寫 `active` 就能繞過「只回未封存記錄」的承諾。插件在 domain 驗證層拒絕 `active` 這道防線**實測確認是必要的，不是多餘的** |
| 7 | **`allowed_company_ids` 的實際效果**與無權 company 是否丟 `AccessError` | 🟡 **錯誤路徑成立，過濾效果未驗** | 實例有 2 個 company，uid=2 的 `company_ids` = `[2,1]`、`company_id` = `[1,"My Company (San Francisco)"]`。帶 `allowed_company_ids:[9999]` → Odoo 拋 **"Access to unauthorized or invalid companies."**。證實 spec 要求的「handshake 先驗 `companyId ∈ company_ids`、設錯回 `INVALID_CONFIG` 而非 `PERMISSION_DENIED`」是對的——因為 Odoo 自己的訊息**不會**告訴使用者是設定錯了。**未驗**：合法 companyId 在各 model 上實際過濾掉哪些記錄 |
| 8 | model 不存在（模組未安裝）時的 `error.data.name` | ✅ **已測得，結果是「無專屬名稱」** | `odoo.exceptions.UserError` + `"Object sale.order doesn't exist"`。UserError 過於泛用，**不足以作為判別依據**，因此依 spec 原訂條件不新增專屬錯誤碼（理由見上節） |
| 9 | `fields_get` 的 `attributes` 參數受支援 | ✅ **成立** | `res.partner` 回 186 個欄位，且**只回要求的 attribute**（char 欄位只有 `readonly`/`required`/`string`/`type`，因為它沒有 `relation`/`selection`）。→ 「放寬 byte 上限」的回退路徑在 Odoo 18 上不會被觸發，但**該回退仍保留**，因為 8–17 版未驗 |
| 10 | 建立 `project.task` 不指定 `stage_id` 時落在第一個階段 | ✅ **成立** | 建立的 task 落在 `stage_id: [1, "New"]`；該專案 stage 順序為 New(seq 1) → In Progress(seq 10) → Done(seq 20)。即「由 Odoo 套用預設階段」= sequence 最小的 stage。建立後 `state` 為 `01_in_progress`。**注意**：四語描述仍維持保守寫法「由 Odoo 套用預設階段」，不改回承諾「第一個階段」——自訂模組仍可改寫此行為 |
| 11 | `sale.order` 只給 `partner_id` 即可建立（pricelist / company 由 onchange 補上） | ✅ **成立** | 乾淨的 `sale.order` 僅帶 `partner_id` 建立成功，回 `{id, name, state:'draft'}`。未出現缺 pricelist 的 `UserError` |
| 12 | 各業務欄位的存在性與 selection 值域（本文件補列，來源 spec §10.1） | ✅ **全部符合** | `sale.order.state` = `draft`/`sent`/`sale`/`cancel`（**`draft` 確實存在**，強制 `state='draft'` 可行）；`project.task.state` = `01_in_progress`/`02_changes_requested`/`03_approved`/`1_done`/`1_canceled`/`04_waiting_normal`（**確實沒有 `draft`**，證實當初改成「禁止指定 state/stage_id」是正確判斷而非猜測）；`account.move.payment_state` = `not_paid`/`in_payment`/`paid`/`partial`/`reversed`/`blocked`/`invoicing_legacy`；`res.partner` 的 `customer_rank`、`supplier_rank` 都存在 |

---

## 政策邊界：真實環境實測結果

這些不是 spec §9 的相容性假設，而是插件自己的安全宣稱。全部在真實 Odoo 上實測。

### 寫入工具 `odoo_create_draft`

| 嘗試 | 結果 |
| --- | --- |
| `sale.order` 自帶 `state:'sale'` | ✅ `INVALID_INPUT: values must not include state` |
| `project.task` 自帶 `state` | ✅ `INVALID_INPUT` |
| `project.task` 自帶 `stage_id` | ✅ `INVALID_INPUT` |
| 白名單外 model `res.users` | ✅ `MODEL_NOT_ALLOWED` |
| one2many 注入 `order_line:[[0,0,{...}]]` | ✅ `INVALID_INPUT: field order_line is not allowed` |
| prototype 鍵 `constructor` | ✅ `INVALID_INPUT: field constructor is not allowed` |
| 乾淨的 `sale.order` | ✅ 成功建立，回 `{id, name, state:'draft'}` |
| 乾淨的 `project.task`（缺 `project_id`） | ✅ `INVALID_INPUT: values must include project_id`（正確，該欄位必填） |

### 唯讀邊界

| 嘗試 | 結果 |
| --- | --- |
| domain 關聯點號穿透 | ✅ `INVALID_INPUT` |
| domain 明寫 `active` | ✅ `INVALID_INPUT` |
| arity 不足的前綴運算子 | ✅ `INVALID_INPUT: missing an operand at index 2` |
| binary 欄位 `image_1920` | ✅ `INVALID_INPUT: is a binary field` |
| 正常查詢 | ✅ 正常回傳 |

### 回應形狀

- many2one 確實是 `[id, display_name]`——例如 `partner_id: [10, "Acme Corporation"]`、`stage_id: [1, "New"]`
- Odoo 以 `false` 表示 null——例如 `client_order_ref: false`
- 投影正確：`createDraft` 只回 `id` / `name` / `state` 三個 readback 欄位

---

## 仍未驗證的範圍

驗過一次不等於驗完。以下明確**未涵蓋**：

| 範圍 | 狀態 |
| --- | --- |
| Odoo 版本 | **只驗了 18.0-20260817**。8–17 與 19 完全未驗，跨版本的欄位名、selection 值域、例外名稱都可能不同 |
| 部署形態 | **只驗了官方 Docker image 直連**。反向代理後方、Odoo Online（SaaS）、Odoo.sh 皆未驗——而 `/jsonrpc` 是否可達正是這些形態最可能出問題的地方 |
| 多公司 | **只驗了錯誤路徑**（無權 company 被拒）。合法 `companyId` 在各 model 上實際過濾掉什麼，未驗 |
| 認證方式 | API key 與登入密碼未分別驗證（spec §9 #3） |
| db 名錯誤 | 未驗（spec §9 #4） |
| 欄位名錯誤的 Odoo 例外名稱 | 未驗（spec §9 #5），且客戶端會先擋 |
| 大型 `fields_get` 的實際體積 | 未量測 byte 數。`account.move` / `res.partner` 是否真的超過 1 MB 預設上限未證實，因此 8 MB 放寬路徑**未被實際觸發過** |
| `res.company` 的存在性 | 量測記錄與「由 `base` 提供」的預期不符，待複核（見上文） |

---

## 怎麼重跑

`scripts/smoke-odoo.sh` 是手動 live 驗證腳本，刻意不進 CI。它每次執行都會先
`bun run build`，避免拿 stale `lib/` 得到錯誤結論。

### 環境變數契約

| 變數 | 必填 | 說明 |
| --- | --- | --- |
| `ODOO_URL` | 是 | Odoo base URL，例如 `https://odoo.example.com`。不得含 query、fragment 或內嵌帳密 |
| `ODOO_DB` | 是 | 資料庫名稱 |
| `ODOO_USERNAME` | 是 | 登入帳號 |
| `ODOO_API_KEY` | 是 | API key 或密碼（spec §9 #3 正是在測這個） |
| `ODOO_COMPANY_ID` | 否 | 設了才會走 `allowed_company_ids` 與 handshake 的公司檢查（spec §9 #7） |
| `ODOO_ALLOW_WRITE` | 否 | `true` 時**會對目標資料庫寫入一筆草稿 sale.order**。不設就是全程唯讀 |

腳本本身沒有任何硬編碼憑證，也不在 npm 封裝內。

### 執行

唯讀（建議先跑這個）：

```bash
ODOO_URL=https://odoo.example.com ODOO_DB=production \
ODOO_USERNAME=integration@example.com ODOO_API_KEY=... \
bash scripts/smoke-odoo.sh
```

含寫入（會建立一筆草稿 sale.order，請對測試資料庫執行）：

```bash
ODOO_URL=... ODOO_DB=... ODOO_USERNAME=... ODOO_API_KEY=... \
ODOO_ALLOW_WRITE=true \
bash scripts/smoke-odoo.sh
```

### 執行順序與對應的假設

| 步驟 | 呼叫 | 驗證到哪些假設 |
| --- | --- | --- |
| 1 | `odoo_server_info` | #1 `/jsonrpc`、#3 API key 當密碼、#7 公司檢查 |
| 2 | `odoo_describe_model('res.partner')` | #9 `fields_get` 的 `attributes` 與 byte 上限 |
| 3 | `odoo_search_read('res.partner', limit 3)` | #6 `active_test`、#12 欄位存在性 |
| 4 | `odoo_search_read('sale.order', limit 3)` | #12 selection 值域；**模組未安裝時會在此失敗** |
| 5 | `odoo_create_draft`（僅 `ODOO_ALLOW_WRITE=true`） | #11 只給 `partner_id` 能否建立、#10 草稿階段 |

### 下次驗證新版本時

在上面的假設表補一欄該版本的結果，不要覆蓋 Odoo 18 這次的記錄——
跨版本差異本身就是最值得留存的資訊。
