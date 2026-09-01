---
name: aws-sandbox-deployment
description: Instructions and workflows for deploying the Creole Knowledge Portal infrastructure, containers, and services to any new AWS Sandbox account or AWS CLI profile.
---

# AWS Sandbox Deployment Skill

Use this skill whenever the user asks to deploy, re-deploy, or migrate the Creole Knowledge Portal to a new AWS Sandbox account, or changes the AWS CLI profile.

## Quick Trigger

To execute a complete deployment to the active AWS Sandbox account:

```bash
./scripts/deploy-aws.sh <AWS_PROFILE_NAME>
```

If no profile name is passed, it uses `$AWS_PROFILE` or defaults to `cloud_user`.

## Core Steps Performed

1. **Identity & Account Detection**:
   - `aws sts get-caller-identity` to extract `ACCOUNT_ID` and ensure region is `us-east-1`.
2. **ECR Authentication & Repository Setup**:
   - Authenticates Docker to `${ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com`.
   - Creates `creole-knowledge-portal-web`, `creole-knowledge-portal-api`, and `creole-knowledge-portal-workers` if missing.
3. **Container Build & Push**:
   - Builds AMD64 images with `NEXT_PUBLIC_BASE_PATH=/creole-knowledge-portal`.
   - Pushes `web`, `api`, and `workers` tags to ECR.
4. **Pulumi Infrastructure Deployment**:
   - Sets `aws:profile` and `aws:region` in Pulumi config.
   - Runs `pulumi up --yes --skip-preview --cwd infra`.
5. **ECS Rolling Deployment**:
   - Forces new task rollout on ECS cluster `ckp-shared`.
6. **Outputs**:
   - Returns the CloudFront URL (`https://<domain>/creole-knowledge-portal`).
   - Alerts on required Supabase OAuth redirect URL additions.

Refer to [AGENT-DEPLOYMENT-RUNBOOK.md](file:///Users/apple/Desktop/creole-knowledge-portal/AGENT-DEPLOYMENT-RUNBOOK.md) for detailed diagnostics and manual overrides.
