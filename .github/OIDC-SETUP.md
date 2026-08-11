# GitHub Actions OIDC → AWS (Creole Knowledge Portal)

Use **OIDC** (no long-lived AWS access keys) for `.github/workflows/deploy-infra.yml`.

| Item | Value |
|------|-------|
| GitHub repo | `Creolestudios/creole-knowledge-portal` |
| AWS account | `761341389675` (`cloud_user` profile, `us-east-1`) |
| Pulumi state bucket | `s3://pulumi-state-761341389675?region=us-east-1&awssdk=v2` |
| Repository variable | `AWS_GHA_DEPLOY_ROLE_ARN` — IAM role ARN for GHA to assume |

**Status (2026-08-11):** OIDC provider and deploy role already created in account `761341389675`.

| Name | Value |
|------|-------|
| `AWS_GHA_DEPLOY_ROLE_ARN` | `arn:aws:iam::761341389675:role/ckp-github-deploy-dev` |

## 1. Create the GitHub OIDC provider (once per account)

If `aws iam list-open-id-connect-providers` returns empty:

```bash
export AWS_PROFILE=cloud_user
export AWS_REGION=us-east-1

aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03fa0217a5d6397dd4a4f5e5e5e
```

## 2. Create the deploy role

Trust policy (restricts to this repo; tighten `sub` to `ref:refs/heads/feat/infra` for prod):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::761341389675:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:Creolestudios/creole-knowledge-portal:*"
        }
      }
    }
  ]
}
```

Attach a policy broad enough for Pulumi CKP infra (ECR, ECS, SG, ALB rules, IAM pass-role, etc.) — mirror TotalMed / stogo-factory deploy roles. Minimum for state backend:

- `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on `pulumi-state-761341389675`
- Standard Pulumi resource permissions for the target account

Example role name: `ckp-github-deploy-dev`

## 3. Configure GitHub

In **Settings → Secrets and variables → Actions → Variables**:

| Name | Example |
|------|---------|
| `AWS_GHA_DEPLOY_ROLE_ARN` | `arn:aws:iam::761341389675:role/ckp-github-deploy-dev` |

Optional: use GitHub **Environments** (`dev`, `prod`) with protection rules before allowing `pulumi up`.

## 4. Verify

1. Push to `main` with the variable set → **Deploy Infrastructure** runs `pulumi preview`.
2. **Actions → Deploy Infrastructure → Run workflow** → choose `preview` or `up`, stack `dev`.

## References

- TotalMed S3 backend: `TGN/projects/TotalMed/totalmed.com/infra/PULUMI-BACKEND.md`
- TotalMed Bitbucket OIDC (same trust pattern, different IdP): `infra/app/stacks/oidc.ts`
- AEROSTACK GitHub OIDC deploy: pinned account + `aws-actions/configure-aws-credentials`
