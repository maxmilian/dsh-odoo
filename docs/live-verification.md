# Live verification 狀態

## 現況：尚未驗證

**截至 2026-08-27，`dsh-odoo` 尚未對任何真實 Odoo 實例執行過 live verification。**

本插件對 Odoo 行為的所有假設，一律來自 Odoo 官方文件，並且**只由 mock 測試覆蓋**。
沒有任何一項在真實伺服器上被證實過。四語 README 的開頭聲明與本文件一致；
本文件是那句聲明的完整版本。

同一批工作中的其他兩個插件狀態不同，不要混淆：

| 插件 | Live verification |
| --- | --- |
| Sentry | 已完成，另有實測結果文件 |
| Grafana | 已完成，另有實測結果文件 |
| **dsh-odoo** | **未執行——沒有可測的 Odoo 實例** |

## 為什麼這份清單不是形式主義

Sentry 那次 live verification 抓到一個**經過三輪 code review 都沒被發現的真 bug**：
short id 裡含連字號的 project slug 會被輸入驗證誤拒。三個 reviewer 讀同一份程式碼都認為
那段 regex 是對的；只有真實資料證明它不對。

「mock 測試全綠」與「對真實系統可用」是兩件事。下面每一列都還停在前者。

## 假設清單（全部未驗證）

來源為 spec §9「第一次接到真實 Odoo 時必須驗證的假設清單」，回退方案保留原文。
「風險」欄是本文件補上的排序，**高**代表假設若不成立會讓整個插件或一整類工具失效，
而不只是單一錯誤碼歸類不準。

| # | 風險 | 假設 | 狀態 | 若不成立的回退方案 |
| --- | --- | --- | --- | --- |
| 1 | **高** | `/jsonrpc` 存在且接受 `service: common/object` | 未驗證 | 已有 `TRANSPORT_UNSUPPORTED` 明確錯誤；若普遍不成立才開 0.2 做 XML-RPC |
| 2 | 中 | JSON-RPC 錯誤時 HTTP 為 200、錯誤在 `error.data.name` / `error.data.message` | 未驗證 | HTTP 分支已先接住；補測試案例即可 |
| 3 | 中 | Odoo API Key 可直接當 `authenticate` 的 password 使用 | 未驗證 | 回退成要求使用者填真實密碼，README 加註 |
| 4 | 低 | db 名錯誤時訊息可辨識 | 未驗證 | 移除該列特判，一律回 `AUTHENTICATION_FAILED` |
| 5 | 低 | 欄位名打錯時 `error.data.name` 是 `builtins.ValueError` 或 `builtins.KeyError` | 未驗證 | 若是別的 exception 名稱，把它加進 G2 白名單與 `ODOO_QUERY_ERROR` 對應表 |
| 6 | **高** | **`active_test` 隱含過濾**：search / search_read 預設只回 `active = true` 的記錄 | 未驗證 | 若成立（預期成立）：維持不開放該 context，工具描述已明說「只回未封存記錄」，`DEFAULT_FIELDS` 不含 `active`。若不成立（某版本預設回全部）：`DEFAULT_FIELDS` 補回 `active` 並修正工具描述 |
| 7 | **高** | **`allowed_company_ids` 的實際效果**：只在有多公司 record rule 的 model 上生效，對 `res.users` / `product.template` 未必過濾。連帶：uid 的 `company_ids` 不含設定值時是否真的丟 `AccessError` | 未驗證 | handshake 已先驗 `companyId ∈ company_ids`，避免誤導成 `PERMISSION_DENIED`。若實測發現對某些 model 完全無效，README 明寫「companyId 只影響有多公司規則的 model」，不擴大實作 |
| 8 | 低 | model 不存在（模組未安裝）時的 `error.data.name` 值 | 未驗證 | 目前保守歸類為 `ODOO_RPC_ERROR`；實測後若有穩定 exception 名稱，再對應成 `NOT_FOUND` 並在訊息提示「模組未安裝」 |
| 9 | **高** | `fields_get` 的 `attributes` 參數受支援 | 未驗證 | **不是 no-op 回退**：改用最小 attribute 集 `fields_get([], ['type'])`；若連 `attributes` 都不支援，該次請求單獨把 byte 上限放寬到 `max(maxResponseBytes, 8 MB)` |
| 10 | 低 | 建立 `project.task` 不指定 `stage_id` 時會落在第一個階段 | 未驗證（承諾已撤回） | 已於 2026-08-27 把四語描述改成「由 Odoo 套用預設階段」，不再對階段位置做承諾。若日後要保證位置，改為先查該 project 的最小 sequence stage 再顯式帶入 |
| 11 | 中 | `sale.order` 只給 `partner_id` 即可建立（pricelist / company 由 onchange 補上） | 未驗證 | 若 Odoo 丟 `UserError`（缺 pricelist），G2 已會把原因透出；必要時把 `pricelist_id` 加進 create 允許欄位 |
| 12 | **高** | 各業務欄位的存在性與 selection 值域：`sale.order.state`、`account.move.payment_state`、`res.partner.customer_rank`、日期欄位是 `date` 還是 `datetime` 等（來源：spec §10.1 的非目標理由） | 未驗證 | v0.1 已刻意不做業務包裝工具，正是因為這類假設**錯了不會報錯、只會靜默回空結果**。改用 `odoo_describe_model` 先問實際欄位與 selection，錯誤一律 `INVALID_INPUT` 出聲，不做靜默降級 |

### 五項最高風險，逐項說明

1. **`/jsonrpc` 是否開放（#1）** —— 整個插件的前提。走的是 JSON-RPC 2.0 `POST {baseUrl}/jsonrpc`，
   由 `web` 模組提供。若該部署沒開放、被反向代理攔掉、或被重導，**所有工具一律
   `TRANSPORT_UNSUPPORTED`**，沒有任何功能可用。未實作 XML-RPC 回退。
2. **`fields_get` 的 `attributes` 是否支援（#9）** —— 欄位型別快取是**所有工具的前置步驟**，
   `odoo_describe_model` 與 `odoo_search_read` 都先過它。不支援就得走上面的回退，
   而完整 `fields_get`（`account.move` / `res.partner`）輕易超過 1 MB 預設上限——
   不放寬 byte 上限會讓每個工具一起壞成 `RESPONSE_TOO_LARGE`。
   （放寬到 `max(maxResponseBytes, 8 MB)` 這段已先實作，不等實測。）
3. **`active_test` 隱含過濾的實際行為（#6）** —— 直接決定四語工具描述裡「只回未封存記錄」
   這句承諾是否成立。目前的作法是不開放 `active_test` context，並且**在 domain 驗證層拒絕
   `active` 欄位**（Odoo 只在 domain 沒提到 `active` 時才套隱含過濾），讓這句話在程式層面站得住。
   但「Odoo 預設確實只回 `active = true`」這個前提本身仍未實測。
4. **`allowed_company_ids` 的實際效果與 `AccessError`（#7）** —— 兩件事都未驗證：
   context 在哪些 model 上真的會過濾，以及 uid 的 `company_ids` 不含設定的 `companyId` 時
   Odoo 是否真的丟 `AccessError`。handshake 會先自行檢查 `companyId ∈ company_ids` 並回
   `INVALID_CONFIG`，就是為了不要讓使用者收到誤導性的「權限不足」。
5. **業務欄位的存在性與 selection 值（#12）** —— 這類假設的失敗模式最糟：**不會報錯，只會靜默
   回空結果**。v0.1 因此不做任何業務包裝工具，把「這個欄位存在嗎、值域是什麼」交還給
   `odoo_describe_model` 去問真實伺服器。

## 拿到真實 Odoo 之後怎麼跑

`scripts/smoke-odoo.sh` 是手動 live 驗證腳本，刻意不進 CI。它每次執行都會先
`bun run build`，避免拿 stale `lib/` 得到錯誤結論。

### 環境變數契約

| 變數 | 必填 | 說明 |
| --- | --- | --- |
| `ODOO_URL` | 是 | Odoo base URL，例如 `https://odoo.example.com`。不得含 query、fragment 或內嵌帳密 |
| `ODOO_DB` | 是 | 資料庫名稱 |
| `ODOO_USERNAME` | 是 | 登入帳號 |
| `ODOO_API_KEY` | 是 | API key 或密碼（假設 #3 正是在測這個） |
| `ODOO_COMPANY_ID` | 否 | 設了才會走 `allowed_company_ids` 與 handshake 的公司檢查（假設 #7） |
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
| 4 | `odoo_search_read('sale.order', limit 3)` | #12 `state` 等 selection 值域 |
| 5 | `odoo_create_draft`（僅 `ODOO_ALLOW_WRITE=true`） | #11 只給 `partner_id` 能否建立、#10 草稿階段 |

### 跑完之後

把結果寫回這份文件：把驗證過的列的「狀態」改成 `已驗證於 Odoo x.y，yyyy-mm-dd`，
不成立的列改成 `不成立` 並執行該列的回退方案。四語 README 開頭的聲明同步更新。
在那之前，這份文件維持「全部未驗證」。
