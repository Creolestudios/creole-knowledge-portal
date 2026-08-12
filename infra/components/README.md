# infra/components

Reusable Pulumi modules for CKP.

| Module | Status | Purpose |
|--------|--------|---------|
| `platform.ts` | Live (imported, protected) | Shared ALB + SG, HTTP listener, ECS cluster, GitHub OIDC + deploy role — do not recreate via AWS CLI |
| `app-secrets.ts` | Live | Pulumi secrets → Secrets Manager → ECS |
| `data-stores.ts` | Placeholder | Security groups + config overrides for Redis/Mongo (unused if Atlas + Upstash) |

Supabase PostgreSQL is **external** — not provisioned here. Inject `NEXT_PUBLIC_SUPABASE_*` and `SUPABASE_SERVICE_ROLE_KEY` via Secrets Manager at deploy time.
