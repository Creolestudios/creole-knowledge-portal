# 🤖 Autonomous Agent Guide: Deploying to AWS Sandbox Accounts

> **Target Audience**: AI Agents (Antigravity, Gemini, Claude, Cursor) & DevOps Engineers  
> **Repository**: `creole-knowledge-portal`  
> **Primary Goal**: Deploy or redeploy the entire Creole Knowledge Portal stack (Next.js 15 Web, FastAPI Backend, Celery Workers, ECS Fargate, ALB, CloudFront) to any new or updated AWS Sandbox account / CLI profile.

---

## ⚡ Quick Deployment (Single Command)

When a user provides a new AWS profile (e.g. `cloud_user`, `sandbox_2`, etc.) or asks to deploy to a new sandbox account:

```bash
# 1. Ensure Docker daemon is running
docker info >/dev/null 2>&1 || open -a Docker

# 2. Run the automated deployment script
./scripts/deploy-aws.sh <AWS_PROFILE_NAME>
```

The script automatically:
1. Validates the AWS profile identity & retrieves the new `ACCOUNT_ID`.
2. Authenticates Docker with the account's Amazon ECR.
3. Automatically creates missing ECR repositories (`web`, `api`, `workers`).
4. Builds the container images for `linux/amd64`.
5. Pushes all container images to the account's ECR.
6. Configures and deploys the infrastructure via Pulumi (`pulumi up --yes --skip-preview`).
7. Triggers ECS rolling deployments on the cluster `ckp-shared`.
8. Prints the CloudFront HTTPS URL and required Supabase Redirect URLs.

---

## 📋 Detailed Step-by-Step Agent Procedure (Manual / Diagnostic Mode)

If you need to perform or debug individual steps autonomously, follow this exact sequence:

### Step 1: Detect & Validate the AWS Profile
Always confirm the active AWS account ID and region before executing any cloud commands:
```bash
export AWS_PROFILE="<PROFILE_NAME>"  # e.g. cloud_user
export AWS_DEFAULT_REGION="us-east-1"

# Verify caller identity
aws sts get-caller-identity
```
Extract:
- `ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)`
- `REGION="us-east-1"`

### Step 2: ECR Authentication & Repository Provisioning
```bash
# Log in to ECR
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# Ensure all 3 required repositories exist
for repo in "creole-knowledge-portal-web" "creole-knowledge-portal-api" "creole-knowledge-portal-workers"; do
  aws ecr describe-repositories --repository-names "$repo" --region "$REGION" >/dev/null 2>&1 || \
  aws ecr create-repository --repository-name "$repo" --region "$REGION"
done
```

### Step 3: Build & Push Container Images (AMD64)
All AWS ECS tasks run on Fargate `linux/amd64`. Always include `--platform linux/amd64`.

1. **Python API & Celery Worker Images**:
   ```bash
   API_IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/creole-knowledge-portal-api:latest"
   WORKER_IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/creole-knowledge-portal-workers:latest"

   docker build --platform linux/amd64 -t "$API_IMAGE" fetch-blogs
   docker push "$API_IMAGE"

   docker tag "$API_IMAGE" "$WORKER_IMAGE"
   docker push "$WORKER_IMAGE"
   ```

2. **Next.js 15 Web Image**:
   *Note: Must include `NEXT_PUBLIC_BASE_PATH=/creole-knowledge-portal` and active Supabase build-args.*
   ```bash
   WEB_IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/creole-knowledge-portal-web:latest"

   docker build --platform linux/amd64 \
     --build-arg NEXT_PUBLIC_BASE_PATH=/creole-knowledge-portal \
     --build-arg NEXT_PUBLIC_SUPABASE_URL="https://pcovgcyjzprkboxbjkey.supabase.co" \
     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjb3ZnY3lqenBya2JveGJqa2V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzQ5NzQsImV4cCI6MjA5MzQ1MDk3NH0.vgqRGVKCevVdErojUVmqtOVi_cdneO88nfEuFOY3bCU" \
     -t "$WEB_IMAGE" .

   docker push "$WEB_IMAGE"
   ```

### Step 4: Configure & Run Pulumi
Configure the Pulumi stack to use the active AWS profile and deploy:
```bash
pulumi config set aws:region "$REGION" --cwd infra
pulumi config set aws:profile "$AWS_PROFILE" --cwd infra

# Deploy stack
pulumi up --yes --skip-preview --cwd infra
```

### Step 5: Force ECS Service Rollout
If services were already created by a previous run or template, force task updates to pull the latest images:
```bash
CLUSTER="ckp-shared"
for svc in $(aws ecs list-services --cluster "$CLUSTER" --query "serviceArns[*]" --output text); do
  aws ecs update-service --cluster "$CLUSTER" --service "$svc" --force-new-deployment
done
```

### Step 6: Health Verification
Wait 60–90 seconds for new tasks to pass target group health checks:
```bash
# Check Target Group Health
for tg in $(aws elbv2 describe-target-groups --query "TargetGroups[*].TargetGroupArn" --output text); do
  aws elbv2 describe-target-health --target-group-arn "$tg" \
    --query "TargetHealthDescriptions[*].[Target.Id, Target.Port, TargetHealth.State]" --output text
done

# Test CloudFront Endpoint
CF_URL=$(pulumi stack output cloudfrontUrl --cwd infra)
curl -s -o /dev/null -w "%{http_code}\n" "$CF_URL"  # Expected: 200
```

---

## 🔒 Post-Deployment Checklist for the Agent

After deployment succeeds, **always present the user with**:
1. **CloudFront Application URL**:
   `https://<CLOUDFRONT_DOMAIN>/creole-knowledge-portal`
2. **Supabase Auth Redirect URL Requirements**:
   Remind the user to ensure the Supabase project has the new CloudFront domain authorized under **Authentication -> URL Configuration -> Redirect URLs**:
   - `https://<CLOUDFRONT_DOMAIN>/creole-knowledge-portal/auth/callback`
   - `https://<CLOUDFRONT_DOMAIN>/creole-knowledge-portal/**`
   - `https://<CLOUDFRONT_DOMAIN>/creole-knowledge-portal`
3. **Architecture Summary**:
   - Web: Port 3000 (Next.js 15 Standalone)
   - API: Port 8000 (FastAPI Python 3.11)
   - Workers: Celery scraping & Gemini AI synthesis
   - CDN: CloudFront with HTTPS termination and custom 60s origin read timeout
