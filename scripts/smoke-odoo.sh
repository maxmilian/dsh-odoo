#!/usr/bin/env bash
# Manual end-to-end check against a real Odoo server. Deliberately excluded from CI.
#
# Usage:
#   ODOO_URL=https://odoo.example.com ODOO_DB=production \
#   ODOO_USERNAME=integration@example.com ODOO_API_KEY=... \
#   [ODOO_COMPANY_ID=1] [ODOO_ALLOW_WRITE=true] \
#   bash scripts/smoke-odoo.sh
#
# ODOO_ALLOW_WRITE=true additionally creates one draft sale.order, which writes
# to the target database. Leave it unset to keep this script read-only.
set -euo pipefail

for variable in ODOO_URL ODOO_DB ODOO_USERNAME ODOO_API_KEY; do
  if [ -z "${!variable:-}" ]; then
    echo "Missing required environment variable: ${variable}" >&2
    echo "See the usage comment at the top of this script." >&2
    exit 1
  fi
done

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

# Always rebuild: a stale lib/ has already produced a wrong live verdict once.
echo "Building the plugin first..."
bun run build

node --input-type=module --eval "
import { createOdooClient } from './lib/index.js'

const allowWrite = process.env.ODOO_ALLOW_WRITE === 'true'
const client = createOdooClient({ allowWrite })

const show = (label, result) => {
  console.log('---', label)
  console.log(JSON.stringify(result, null, 2).slice(0, 2000))
}

show('odoo_server_info', await client.serverInfo())
show('odoo_describe_model res.partner', await client.describeModel('res.partner'))
show('odoo_search_read res.partner', await client.searchRead({ model: 'res.partner', limit: 3 }))
show('odoo_search_read sale.order', await client.searchRead({ model: 'sale.order', limit: 3 }))

if (!allowWrite) {
  console.log('--- odoo_create_draft skipped (set ODOO_ALLOW_WRITE=true to exercise it)')
  process.exit(0)
}

const partners = await client.searchRead({ model: 'res.partner', fields: ['id'], limit: 1 })
const partnerId = Array.isArray(partners.data) ? partners.data[0]?.id : undefined
if (partnerId === undefined) {
  console.log('--- odoo_create_draft skipped (no partner available)')
  process.exit(0)
}
show('odoo_create_draft', await client.createDraft({
  model: 'sale.order',
  values: { partner_id: partnerId },
}))
"
