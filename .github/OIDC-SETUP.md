# GitHub Actions OIDC → AWS (Creole Knowledge Portal)

Use **OIDC** (no long-lived AWS access keys) for `.github/workflows/deploy-infra.yml` and `.github/workflows/deploy-app.yml`.

| Item | Value |
|------|-------|
| GitHub repo | `Creolestudios/creole-knowledge-portal` |
| AWS account | `715736407442` (`cloud_user` profile, `us-east-1`) |
| Pulumi state bucket | `s3://pulumi-state-715736407442?region=us-east-1&awssdk=v2` |
| Repository variable | `AWS_GHA_DEPLOY_ROLE_ARN` — IAM role ARN for GHA to assume |

**Do not create the OIDC provider or deploy role with the AWS CLI.** Both are Pulumi-owned (`infra/components/platform.ts`) and were imported into stack `dev`.

| Name | Value |
|------|-------|
| `AWS_GHA_DEPLOY_ROLE_ARN` | `arn:aws:iam::715736407442:role/ckp-github-deploy-dev` |
| OIDC provider | `arn:aws:iam::715736407442:oidc-provider/token.actions.githubusercontent.com` |
| Thumbprint | `6938fd4d98bab03fa0217a5d6397dd4a4f5e5e5e` |

Change trust policy, thumbprint, or permissions in Pulumi and `pulumi up` — never `aws iam create-*`.

## 1. Pulumi resources (already imported)

Defined in [`infra/components/platform.ts`](../infra/components/platform.ts):

- `ckp-github-oidc` — GitHub Actions OIDC provider (`token.actions.githubusercontent.com`, audience `sts.amazonaws.com`)
- `ckp-github-deploy-role` — `ckp-github-deploy-dev`
- `ckp-github-deploy-policy` — inline `ckp-pulumi-deploy`

Trust is restricted to this repo (`repo:Creolestudios/creole-knowledge-portal:*`). Tighten `sub` to a branch ref for prod.

## 2. Configure GitHub

In **Settings → Secrets and variables → Actions → Variables**:

| Name | Example |
|------|---------|
| `AWS_GHA_DEPLOY_ROLE_ARN` | `arn:aws:iam::715736407442:role/ckp-github-deploy-dev` |

Optional: use GitHub **Environments** (`dev`, `prod`) with protection rules before allowing `pulumi up`.

## 3. Verify

1. Push to `main` with the variable set → **Deploy Infrastructure** runs `pulumi preview`.
2. **Actions → Deploy Infrastructure → Run workflow** → choose `preview` or `up`, stack `dev`.
