# Pulumi state backend (cloud_user account `761341389675`)

Use this account’s **S3** backend — not Pulumi Cloud.

```bash
export AWS_PROFILE=cloud_user
export AWS_REGION=us-east-1

pulumi login 's3://pulumi-state-761341389675?region=us-east-1&awssdk=v2'
```

| Resource | Name |
|----------|------|
| State bucket | `pulumi-state-761341389675` (versioning enabled) |
| Region | `us-east-1` |
| Lock table | Not created yet (optional `pulumi-state-locks` DynamoDB table) |

**Important:** Run `pulumi login` to the S3 URL **before** `stack select` / `preview` / `up`. The project `Pulumi.yaml` also declares this backend URL so CI/local runs stay aligned.

## Stacks

| Project dir | Project name | Stack | Notes |
|-------------|--------------|-------|-------|
| `infra/` | `creole-knowledge-portal` | `dev` | Option 3 CKP — shared VPC, ECS Fargate |

Stack FQN on S3 backend: `creole-knowledge-portal/dev` (organization defaults to `organization` unless configured).

## Bootstrap bucket (if missing)

Already provisioned in account `761341389675`. To recreate:

```bash
export AWS_PROFILE=cloud_user
aws s3api create-bucket --bucket pulumi-state-761341389675 --region us-east-1
aws s3api put-bucket-versioning \
  --bucket pulumi-state-761341389675 \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block \
  --bucket pulumi-state-761341389675 \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

## GitHub Actions

See [`.github/OIDC-SETUP.md`](../.github/OIDC-SETUP.md). Set repository variable `AWS_GHA_DEPLOY_ROLE_ARN` before enabling deploy workflows.
