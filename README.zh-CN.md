# dsh-odoo

[English](README.md) | [繁體中文](README.zh-TW.md) | 简体中文 | [日本語](README.ja.md)

`dsh-odoo` 是一个免费、开源、以只读为主的 DeepSeek Harness 插件，对接 Odoo external API。
它让 agent 能查看 Odoo 的业务数据——联系人、报价单、销售订单、发票、项目任务、商机、库存——
而不会改动 Odoo 状态。另有一个需显式开启的工具可创建受严格限制的草稿记录；未开启时该工具根本不会注册。

> ⚠️ **尚未对真实 Odoo 服务器做过 live 验证。** 本版本的所有兼容性假设均取自 Odoo 官方文档，
> 仅由 mock 测试覆盖。正式依赖前请先对你自己的实例进行验证。

## 工具

| 工具 | 用途 |
| --- | --- |
| `odoo_server_info` | 读取服务器版本与当前登录的用户 id。 |
| `odoo_describe_model` | 列出白名单 model 的可查询字段。 |
| `odoo_search_read` | 在白名单 model 上执行受限的 `search_read`。 |
| `odoo_create_draft` | 创建一条草稿记录。**需要 `allowWrite: true`**；否则永远不会注册。 |

## 传输方式

本插件以 **JSON-RPC 2.0** 调用 `POST {baseUrl}/jsonrpc`，因此你的 Odoo 必须开放该端点
（由 `web` 模块提供）。若端点不存在、被重定向或被 proxy 拦截，所有工具都会以
`TRANSPORT_UNSUPPORTED` 错误明确告知。本版本未实现 XML-RPC。

## 需求

- 具备兼容 `@deepseek-ai/dsh-tools` API 的 DeepSeek Harness
- Node.js 22.19 以上（22.x 线）或 Node.js 24 以上
- 从 GitHub 源码安装或本地开发时需 Bun 1.3.5 以上
- Odoo 地址、数据库名称、登录账号与 API key（或密码），且对要查询的 model 有访问权限

## 配置

建议使用环境变量，避免凭证出现在 profile patch 中：

```sh
export ODOO_URL='https://odoo.example.com'
export ODOO_DB='production'
export ODOO_USERNAME='integration@example.com'
export ODOO_API_KEY='your-api-key'
```

plugin config 的优先级高于环境变量：

| Config | 环境变量 fallback | 默认值 |
| --- | --- | --- |
| `baseUrl` | `ODOO_URL` | 必填 |
| `db` | `ODOO_DB` | 必填 |
| `username` | `ODOO_USERNAME` | 必填 |
| `apiKey` | `ODOO_API_KEY` | 必填 |
| `companyId` | `ODOO_COMPANY_ID` | 未设置 |
| `allowWrite` | 无（刻意不提供） | `false` |
| `locale` | 无 | `en`（`en` / `zh-TW` / `zh-CN` / `ja`） |
| `defaultLimit` | 无 | `20`（1–100） |
| `requestTimeoutMs` | 无 | `30000`（1–300000） |
| `maxResponseBytes` | 无 | `1000000`（1–52428800） |

凭证只有在工具实际执行时才需要：装了插件但还没填配置不会导致 profile 加载失败。
`locale` 只切换工具与参数的描述；工具名称与错误信息始终保持英文。

## 安全边界

- **默认只读。** 本版本没有 `write`、`unlink` 或任何 workflow 动作。
- **Model 白名单。** 查询限于 14 个标准 model：`res.partner`、`res.users`、`res.company`、
  `product.product`、`product.template`、`sale.order`、`sale.order.line`、`purchase.order`、
  `account.move`、`account.move.line`、`project.project`、`project.task`、`crm.lead`、`stock.quant`。
- **不允许关联穿透。** domain 的字段名不得包含点号。要按关联记录过滤时，请先查询关联 model 获取 id，
  再用 `('partner_id','in',[ids])` 过滤。这让白名单成为真正的能力边界，而不只是建议。
- **不返回 binary 字段。** Odoo 类型为 `binary` 的字段一律拒绝，默认字段集也不含任何一个。
- **响应有上限。** 每个 model 有默认字段集、`limit` ≤ 100、`offset + limit` ≤ 10000、
  单个字符串值超过 2000 字符会被截断，并且每个响应都有硬性字节上限。
- **只返回未归档的记录**；不开放 `active_test` context。
- **草稿创建需开启且形式固定。** `sale.order` 一律以 `state=draft` 创建；
  `project.task` 不得指定 `state` 或 `stage_id`，阶段由 Odoo 套用默认阶段。
  只接受白名单字段，并拒绝 one-to-many 命令。

## 0.1 的非目标

- 不做业务包装工具（`list_customers`、`list_quotations` 等）。它们依赖无法在没有真实 Odoo 的情况下
  验证的字段假设，而假设错了会返回空结果而非报错——对 agent 而言是最糟的失败模式。推迟到 0.2。
- 不做更新、删除或 workflow 转换；不处理附件与报表生成。
- 不做 XML-RPC 传输、不做 model 探索、不做多数据库切换、不做 cursor 分页。

## 开发

```sh
bun install
bun run lint
bun run typecheck
bun run test
bun run build
```

`scripts/smoke-odoo.sh` 是对真实服务器的手动端到端检查，刻意不纳入 CI。

## 许可证

MIT
