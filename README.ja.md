# dsh-odoo

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | 日本語

`dsh-odoo` は Odoo external API 向けの、無料・オープンソースで読み取り専用を基本とする
DeepSeek Harness プラグインです。エージェントは Odoo の状態を変更することなく、業務データ
（連絡先、見積、受注、請求書、プロジェクトタスク、リード、在庫）を参照できます。
明示的に有効化した場合のみ、厳しく制限されたドラフトレコードを作成するツールが 1 つ追加されます。
無効のときはそのツール自体が登録されません。

> ⚠️ **実際の Odoo サーバーでの検証は未実施です。** 本リリースの互換性に関する前提はすべて
> Odoo の公式ドキュメントに基づくもので、モックテストのみでカバーされています。
> 本番で依存する前に、ご自身のインスタンスで検証してください。

## ツール

| ツール | 用途 |
| --- | --- |
| `odoo_server_info` | サーバーのバージョンと認証済みユーザー id を読み取ります。 |
| `odoo_describe_model` | 許可リストにある model の照会可能なフィールドを一覧します。 |
| `odoo_search_read` | 許可リストにある model に対して制限付きの `search_read` を実行します。 |
| `odoo_create_draft` | ドラフトレコードを 1 件作成します。**`allowWrite: true` が必要**で、それ以外では登録されません。 |

## トランスポート

本プラグインは **JSON-RPC 2.0** で `POST {baseUrl}/jsonrpc` を呼び出すため、Odoo サーバーが
このエンドポイント（`web` モジュールが提供）を公開している必要があります。エンドポイントが
存在しない、リダイレクトされる、プロキシに遮断される場合は、すべてのツールが
`TRANSPORT_UNSUPPORTED` エラーでその旨を通知します。XML-RPC は実装していません。

## 必要条件

- 互換性のある `@deepseek-ai/dsh-tools` API を備えた DeepSeek Harness
- Node.js 22.19 以上（22.x 系）または Node.js 24 以上
- GitHub ソースからのインストールやローカル開発には Bun 1.3.5 以上
- Odoo の URL、データベース名、ログイン名、API キー（またはパスワード）と、対象 model へのアクセス権

## 設定

認証情報がプロファイルパッチに現れないよう、環境変数の利用を推奨します:

```sh
export ODOO_URL='https://odoo.example.com'
export ODOO_DB='production'
export ODOO_USERNAME='integration@example.com'
export ODOO_API_KEY='your-api-key'
```

プラグイン設定は環境変数より優先されます:

| Config | 環境変数フォールバック | 既定値 |
| --- | --- | --- |
| `baseUrl` | `ODOO_URL` | 必須 |
| `db` | `ODOO_DB` | 必須 |
| `username` | `ODOO_USERNAME` | 必須 |
| `apiKey` | `ODOO_API_KEY` | 必須 |
| `companyId` | `ODOO_COMPANY_ID` | 未設定 |
| `allowWrite` | なし（意図的に非対応） | `false` |
| `locale` | なし | `en`（`en` / `zh-TW` / `zh-CN` / `ja`） |
| `defaultLimit` | なし | `20`（1〜100） |
| `requestTimeoutMs` | なし | `30000`（1〜300000） |
| `maxResponseBytes` | なし | `1000000`（1〜52428800） |

認証情報はツールを実際に実行するときにのみ必要です。プラグインを導入しただけで未設定の状態でも、
プロファイルの読み込みは失敗しません。`locale` はツールとパラメータの説明のみを切り替え、
ツール名とエラーメッセージは常に英語のままです。

## 安全境界

- **既定で読み取り専用。** 本リリースに `write`、`unlink`、ワークフロー操作はありません。
- **Model 許可リスト。** 照会できるのは標準の 14 model のみです: `res.partner`、`res.users`、
  `res.company`、`product.product`、`product.template`、`sale.order`、`sale.order.line`、
  `purchase.order`、`account.move`、`account.move.line`、`project.project`、`project.task`、
  `crm.lead`、`stock.quant`。
- **リレーションのたどりは不可。** domain のフィールド名にドットは使えません。関連レコードで
  絞り込むには、まず関連 model を照会して id を取得し、`('partner_id','in',[ids])` を使います。
  これにより許可リストは提案ではなく実際の能力境界になります。
- **binary フィールドは返しません。** Odoo の型が `binary` のフィールドは拒否され、
  既定フィールドセットにも含まれません。
- **レスポンスに上限。** model ごとの既定フィールド、`limit` ≤ 100、`offset + limit` ≤ 10000、
  1 つの文字列値は 2000 文字で切り詰め、すべてのレスポンスにバイト数の上限があります。
- **アーカイブされていないレコードのみ**を返します。`active_test` コンテキストは公開しません。
- **ドラフト作成は明示的な有効化が必要で、形も固定です。** `sale.order` は常に `state=draft` で
  作成され、`project.task` は `state` や `stage_id` を指定できず、プロジェクトの最初のステージに
  置かれます。許可リストのフィールドのみ受け付け、one-to-many コマンドは拒否します。

## 0.1 の非目標

- 業務ラッパーツール（`list_customers`、`list_quotations` など）は作りません。実際の Odoo なしでは
  検証できないフィールド前提に依存しており、前提が誤っていてもエラーではなく空の結果を返します。
  これはエージェントにとって最悪の失敗モードです。0.2 に延期します。
- 更新・削除・ワークフロー遷移は行いません。添付ファイルやレポート生成も扱いません。
- XML-RPC トランスポート、model の探索、複数データベースの切り替え、カーソルページングは行いません。

## 開発

```sh
bun install
bun run lint
bun run typecheck
bun run test
bun run build
```

`scripts/smoke-odoo.sh` は実サーバーに対する手動のエンドツーエンド確認で、意図的に CI から除外しています。

## ライセンス

MIT
