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

## Only allowed CLI leftover

This bucket **cannot** live in the same Pulumi stack it stores: creating it requires a backend that already exists (chicken-and-egg). It is the **only** CKP AWS resource allowed to remain CLI-created.

- Do **not** import it into stack `dev`.
- Do **not** use the AWS CLI to create other CKP infra (ALB, ECS, IAM, listeners, …). Those are Pulumi-owned — see [`README.md`](./README.md#ownership-policy-no-aws-cli).
- Do **not** recreate this bucket unless it is actually missing.

## Stacks

| Project dir | Project name | Stack | Notes |
|-------------|--------------|-------|-------|
| `infra/` | `creole-knowledge-portal` | `dev` | Pulumi-owned platform + ECS Fargate |

Stack FQN on S3 backend: `creole-knowledge-portal/dev` (organization defaults to `organization` unless configured).

## Disaster recovery only (bucket missing)

If — and only if — `pulumi-state-761341389675` does not exist, recreate the backend bucket. This is not a bootstrap path for new CKP resources.

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
