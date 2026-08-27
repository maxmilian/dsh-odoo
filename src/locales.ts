import type { Locale } from './config.js'

/** Localized model-facing descriptions and pending-call titles. */
export interface OdooMessages {
  readonly serverInfoDescription: string
  readonly describeModelDescription: string
  readonly searchReadDescription: string
  readonly createDraftDescription: string
  readonly createDraftTitle: string
  readonly modelParam: string
  readonly describeModelParam: string
  readonly domainParam: string
  readonly fieldsParam: string
  readonly limitParam: string
  readonly offsetParam: string
  readonly orderParam: string
  readonly writeModelParam: string
  readonly valuesParam: string
}

const ENGLISH: OdooMessages = {
  serverInfoDescription: 'Read the connected Odoo server version and the authenticated user id.',
  describeModelDescription:
    'List the queryable fields of one allow-listed Odoo model: name, type, label, relation, and selection values. Call this before building a domain for odoo_search_read.',
  searchReadDescription:
    "Run a restricted search_read on one allow-listed Odoo model. Domain field names may not contain dots, so related-record conditions are not possible: query the related model first, then filter with ('field_id','in',[ids]). Only non-archived records are returned. When fields are omitted, a fixed default field set for that model is used.",
  createDraftDescription:
    'Create one draft record in Odoo. Only sale.order and project.task are allowed. A sale.order is always created with state=draft; a project.task may not specify state or stage_id, so Odoo applies its own default stage.',
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

const TRADITIONAL_CHINESE: OdooMessages = {
  serverInfoDescription: '讀取已連線 Odoo 伺服器的版本與目前登入的使用者 id。',
  describeModelDescription:
    '列出白名單 Odoo model 的可查詢欄位：名稱、型別、標籤、關聯 model 與選項值。在為 odoo_search_read 組 domain 之前請先呼叫此工具。',
  searchReadDescription:
    "在白名單 Odoo model 上執行受限的 search_read。domain 的欄位名不得含點號，因此無法做關聯記錄條件：請先查詢關聯 model 取得 id，再用 ('field_id','in',[ids]) 過濾。只會回傳未封存的記錄。未指定 fields 時，會套用該 model 的固定預設欄位集。",
  createDraftDescription:
    '在 Odoo 建立一筆草稿記錄。僅允許 sale.order 與 project.task。sale.order 一律以 state=draft 建立；project.task 不得指定 state 或 stage_id，階段由 Odoo 套用預設階段。',
  createDraftTitle: '建立 Odoo 草稿記錄',
  modelParam: '要查詢的 Odoo model；僅接受白名單內的 model',
  describeModelParam: '要描述的 Odoo model；僅接受白名單內的 model',
  domainParam: "以前綴表示法陣列表達的 Odoo domain，例如 [['state','=','draft']]。欄位名不得含點號",
  fieldsParam: '要回傳的欄位名稱，1-30 個；省略時使用該 model 的預設欄位集',
  limitParam: '最多回傳的記錄數，1-100',
  offsetParam: '要略過的記錄數；offset 加 limit 不得超過 10000',
  orderParam: '排序子句，例如 "date_order desc"，最多三段',
  writeModelParam: '要建立草稿的 model：sale.order 或 project.task',
  valuesParam: '新草稿記錄的欄位值；僅接受白名單欄位，且不得設定 state 或 stage_id',
}

const SIMPLIFIED_CHINESE: OdooMessages = {
  serverInfoDescription: '读取已连接 Odoo 服务器的版本与当前登录的用户 id。',
  describeModelDescription:
    '列出白名单 Odoo model 的可查询字段：名称、类型、标签、关联 model 与选项值。在为 odoo_search_read 组装 domain 之前请先调用此工具。',
  searchReadDescription:
    "在白名单 Odoo model 上执行受限的 search_read。domain 的字段名不得包含点号，因此无法做关联记录条件：请先查询关联 model 获取 id，再用 ('field_id','in',[ids]) 过滤。只会返回未归档的记录。未指定 fields 时，会套用该 model 的固定默认字段集。",
  createDraftDescription:
    '在 Odoo 创建一条草稿记录。仅允许 sale.order 与 project.task。sale.order 一律以 state=draft 创建；project.task 不得指定 state 或 stage_id，阶段由 Odoo 套用默认阶段。',
  createDraftTitle: '创建 Odoo 草稿记录',
  modelParam: '要查询的 Odoo model；仅接受白名单内的 model',
  describeModelParam: '要描述的 Odoo model；仅接受白名单内的 model',
  domainParam:
    "以前缀表示法数组表达的 Odoo domain，例如 [['state','=','draft']]。字段名不得包含点号",
  fieldsParam: '要返回的字段名称，1-30 个；省略时使用该 model 的默认字段集',
  limitParam: '最多返回的记录数，1-100',
  offsetParam: '要跳过的记录数；offset 加 limit 不得超过 10000',
  orderParam: '排序子句，例如 "date_order desc"，最多三段',
  writeModelParam: '要创建草稿的 model：sale.order 或 project.task',
  valuesParam: '新草稿记录的字段值；仅接受白名单字段，且不得设置 state 或 stage_id',
}

const JAPANESE: OdooMessages = {
  serverInfoDescription: '接続中の Odoo サーバーのバージョンと認証済みユーザー id を読み取ります。',
  describeModelDescription:
    '許可リストにある Odoo model の照会可能なフィールド（名前、型、ラベル、リレーション、選択肢）を一覧します。odoo_search_read の domain を組み立てる前に呼び出してください。',
  searchReadDescription:
    "許可リストにある Odoo model に対して制限付きの search_read を実行します。domain のフィールド名にドットは使えないため、関連レコード条件は指定できません。まず関連 model を照会して id を取得し、('field_id','in',[ids]) で絞り込んでください。アーカイブされていないレコードのみを返します。fields を省略した場合、その model の既定フィールドセットが使われます。",
  createDraftDescription:
    'Odoo にドラフトレコードを 1 件作成します。許可されるのは sale.order と project.task のみです。sale.order は常に state=draft で作成され、project.task は state や stage_id を指定できず、ステージは Odoo の既定のステージが適用されます。',
  createDraftTitle: 'Odoo のドラフトレコードを作成',
  modelParam: '照会する Odoo model。許可リストにある model のみ受け付けます',
  describeModelParam: '説明する Odoo model。許可リストにある model のみ受け付けます',
  domainParam:
    "前置記法の配列で表す Odoo domain（例: [['state','=','draft']]）。フィールド名にドットは使えません",
  fieldsParam: '返すフィールド名（1〜30）。省略時はその model の既定フィールドセットを使います',
  limitParam: '返すレコードの最大件数（1〜100）',
  offsetParam: 'スキップする件数。offset と limit の合計は 10000 を超えられません',
  orderParam: '"date_order desc" のような並び順。最大 3 項目',
  writeModelParam: 'ドラフトを作成する model: sale.order または project.task',
  valuesParam:
    '新しいドラフトレコードのフィールド値。許可リストのフィールドのみ受け付け、state や stage_id は設定できません',
}

/** Localized tool metadata for every supported locale. */
export const MESSAGES = {
  en: ENGLISH,
  'zh-TW': TRADITIONAL_CHINESE,
  'zh-CN': SIMPLIFIED_CHINESE,
  ja: JAPANESE,
} as const satisfies Record<Locale, OdooMessages>

/** Returns tool metadata for a locale, falling back to English. */
export function odooMessages(locale: Locale): OdooMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}

interface ConfigLocaleMessages {
  readonly $description: string
  readonly baseUrl: string
  readonly db: string
  readonly username: string
  readonly apiKey: string
  readonly companyId: string
  readonly allowWrite: string
  readonly locale: string
  readonly defaultLimit: string
  readonly requestTimeoutMs: string
  readonly maxResponseBytes: string
}

const ENGLISH_CONFIG = {
  $description: 'Read-only Odoo integration settings, with opt-in draft creation.',
  baseUrl: 'Odoo base URL. Falls back to ODOO_URL.',
  db: 'Odoo database name. Falls back to ODOO_DB.',
  username: 'Odoo login. Falls back to ODOO_USERNAME.',
  apiKey: 'Odoo API key or password. Prefer the ODOO_API_KEY environment variable.',
  companyId: 'Company applied to every call. Falls back to ODOO_COMPANY_ID.',
  allowWrite: 'Registers the restricted draft creation tool. Disabled by default.',
  locale: 'Language used by tool descriptions. Tool names stay in English.',
  defaultLimit: 'Records returned when a search does not specify a limit.',
  requestTimeoutMs: 'Request timeout in milliseconds.',
  maxResponseBytes: 'Maximum successful response body size in bytes.',
} as const satisfies ConfigLocaleMessages

const TRADITIONAL_CHINESE_CONFIG = {
  $description: 'Odoo 唯讀整合設定，草稿建立需另行開啟。',
  baseUrl: 'Odoo 基底網址；未設定時讀取 ODOO_URL。',
  db: 'Odoo 資料庫名稱；未設定時讀取 ODOO_DB。',
  username: 'Odoo 登入帳號；未設定時讀取 ODOO_USERNAME。',
  apiKey: 'Odoo API key 或密碼；建議使用 ODOO_API_KEY 環境變數。',
  companyId: '套用於每次呼叫的公司；未設定時讀取 ODOO_COMPANY_ID。',
  allowWrite: '註冊受限的草稿建立工具；預設關閉。',
  locale: '工具描述使用的語言；工具名稱固定為英文。',
  defaultLimit: '查詢未指定筆數時回傳的記錄數。',
  requestTimeoutMs: '請求逾時時間（毫秒）。',
  maxResponseBytes: '成功回應內容的大小上限（位元組）。',
} as const satisfies ConfigLocaleMessages

const SIMPLIFIED_CHINESE_CONFIG = {
  $description: 'Odoo 只读集成设置，草稿创建需另行开启。',
  baseUrl: 'Odoo 基础 URL；未设置时读取 ODOO_URL。',
  db: 'Odoo 数据库名称；未设置时读取 ODOO_DB。',
  username: 'Odoo 登录账号；未设置时读取 ODOO_USERNAME。',
  apiKey: 'Odoo API key 或密码；建议使用 ODOO_API_KEY 环境变量。',
  companyId: '应用于每次调用的公司；未设置时读取 ODOO_COMPANY_ID。',
  allowWrite: '注册受限的草稿创建工具；默认关闭。',
  locale: '工具描述使用的语言；工具名称固定为英文。',
  defaultLimit: '查询未指定条数时返回的记录数。',
  requestTimeoutMs: '请求超时时间（毫秒）。',
  maxResponseBytes: '成功响应内容的大小上限（字节）。',
} as const satisfies ConfigLocaleMessages

const JAPANESE_CONFIG = {
  $description: 'Odoo の読み取り専用連携設定。ドラフト作成は明示的に有効化が必要です。',
  baseUrl: 'Odoo のベース URL。未設定の場合は ODOO_URL を使用します。',
  db: 'Odoo のデータベース名。未設定の場合は ODOO_DB を使用します。',
  username: 'Odoo のログイン名。未設定の場合は ODOO_USERNAME を使用します。',
  apiKey: 'Odoo の API キーまたはパスワード。ODOO_API_KEY 環境変数の使用を推奨します。',
  companyId: 'すべての呼び出しに適用する会社。未設定の場合は ODOO_COMPANY_ID を使用します。',
  allowWrite: '制限付きのドラフト作成ツールを登録します。既定では無効です。',
  locale: 'ツールの説明に使う言語。ツール名は常に英語です。',
  defaultLimit: '検索で件数を指定しなかった場合に返すレコード数。',
  requestTimeoutMs: 'リクエストのタイムアウト時間（ミリ秒）。',
  maxResponseBytes: '成功レスポンス本文の最大サイズ（バイト）。',
} as const satisfies ConfigLocaleMessages

/** Localized descriptions consumed by the Schemastery configuration schema. */
export const CONFIG_I18N = {
  en: ENGLISH_CONFIG,
  'en-US': ENGLISH_CONFIG,
  zh: SIMPLIFIED_CHINESE_CONFIG,
  'zh-CN': SIMPLIFIED_CHINESE_CONFIG,
  'zh-TW': TRADITIONAL_CHINESE_CONFIG,
  ja: JAPANESE_CONFIG,
  'ja-JP': JAPANESE_CONFIG,
} as const satisfies Record<string, ConfigLocaleMessages>
