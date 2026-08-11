# infra/components

Reusable Pulumi modules for CKP.

| Module | Status | Purpose |
|--------|--------|---------|
| `data-stores.ts` | Placeholder | Security groups + config overrides for Redis (ElastiCache) and MongoDB (DocumentDB or Atlas) |

Supabase PostgreSQL is **external** — not provisioned here. Inject `NEXT_PUBLIC_SUPABASE_*` and `SUPABASE_SERVICE_ROLE_KEY` via Secrets Manager at deploy time.
