#!/usr/bin/env bash
# ==============================================================================
# Creole Knowledge Portal — Automated AWS Sandbox Deployment Script
# ==============================================================================
# Usage:
#   ./scripts/deploy-aws.sh [AWS_PROFILE]
# Example:
#   ./scripts/deploy-aws.sh cloud_user
# ==============================================================================

set -euo pipefail

PROFILE="${1:-${AWS_PROFILE:-cloud_user}}"
export AWS_PROFILE="$PROFILE"
export AWS_DEFAULT_REGION="us-east-1"
REGION="us-east-1"

echo "=================================================================="
echo "🚀 Starting Deployment for AWS Profile: $AWS_PROFILE (Region: $REGION)"
echo "=================================================================="

# 1. Verify AWS Identity
echo "==> Verifying AWS identity..."
IDENTITY=$(aws sts get-caller-identity --output json)
ACCOUNT_ID=$(echo "$IDENTITY" | grep -o '"Account": "[^"]*' | cut -d'"' -f4)
ARN=$(echo "$IDENTITY" | grep -o '"Arn": "[^"]*' | cut -d'"' -f4)

echo "    Account ID: $ACCOUNT_ID"
echo "    Caller ARN: $ARN"

if [ -z "$ACCOUNT_ID" ]; then
  echo "❌ Error: Could not determine AWS Account ID. Check your AWS profile configuration."
  exit 1
fi

ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# 2. Login to ECR
echo "==> Authenticating Docker with Amazon ECR ($ECR_REGISTRY)..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

# 3. Ensure ECR Repositories Exist
REPOS=("creole-knowledge-portal-web" "creole-knowledge-portal-api" "creole-knowledge-portal-workers")
for repo in "${REPOS[@]}"; do
  if ! aws ecr describe-repositories --repository-names "$repo" --region "$REGION" >/dev/null 2>&1; then
    echo "==> Creating missing ECR repository: $repo..."
    aws ecr create-repository --repository-name "$repo" --region "$REGION" >/dev/null
  fi
done

# 4. Set Pulumi Configuration
echo "==> Configuring Pulumi stack..."
pulumi config set aws:region "$REGION" --cwd infra
pulumi config set aws:profile "$AWS_PROFILE" --cwd infra

# 5. Build and Push Backend API & Worker Containers
echo "==> Building and pushing API/Worker image..."
API_IMAGE="${ECR_REGISTRY}/creole-knowledge-portal-api:latest"
WORKERS_IMAGE="${ECR_REGISTRY}/creole-knowledge-portal-workers:latest"

docker build --platform linux/amd64 -t "$API_IMAGE" fetch-blogs
docker push "$API_IMAGE"

docker tag "$API_IMAGE" "$WORKERS_IMAGE"
docker push "$WORKERS_IMAGE"

# 6. Build and Push Next.js Web Container
echo "==> Building and pushing Web image..."
WEB_IMAGE="${ECR_REGISTRY}/creole-knowledge-portal-web:latest"

SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://pcovgcyjzprkboxbjkey.supabase.co}"
SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjb3ZnY3lqenBya2JveGJqa2V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzQ5NzQsImV4cCI6MjA5MzQ1MDk3NH0.vgqRGVKCevVdErojUVmqtOVi_cdneO88nfEuFOY3bCU}"

docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_BASE_PATH=/creole-knowledge-portal \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  -t "$WEB_IMAGE" .

docker push "$WEB_IMAGE"

# 7. Apply Pulumi Infrastructure
echo "==> Deploying Infrastructure via Pulumi..."
pulumi up --yes --skip-preview --cwd infra

# 8. Force ECS Service Updates
echo "==> Triggering ECS Service rolling deployments..."
CLUSTER="ckp-shared"
for svc in $(aws ecs list-services --cluster "$CLUSTER" --query "serviceArns[*]" --output text 2>/dev/null || true); do
  if [ -n "$svc" ]; then
    echo "    Updating service: $svc"
    aws ecs update-service --cluster "$CLUSTER" --service "$svc" --force-new-deployment >/dev/null 2>&1 || true
  fi
done

# 9. Outputs & Verification
echo "=================================================================="
echo "🎉 Deployment Completed Successfully!"
echo "=================================================================="

CF_URL=$(pulumi stack output cloudfrontUrl --cwd infra 2>/dev/null || echo "Check CloudFront in AWS Console")
CF_DOMAIN=$(pulumi stack output cloudfrontDomain --cwd infra 2>/dev/null || echo "")
ALB_DNS=$(pulumi stack output albDnsName --cwd infra 2>/dev/null || echo "")

echo "🌐 CloudFront App URL: $CF_URL"
echo "🌐 Direct ALB URL:     http://${ALB_DNS}/creole-knowledge-portal"
echo ""
echo "⚠️  ACTION REQUIRED: Ensure Supabase Redirect URLs include:"
if [ -n "$CF_DOMAIN" ]; then
  echo "    - https://${CF_DOMAIN}/creole-knowledge-portal/auth/callback"
  echo "    - https://${CF_DOMAIN}/creole-knowledge-portal/**"
  echo "    - https://${CF_DOMAIN}/creole-knowledge-portal"
fi
echo "=================================================================="
