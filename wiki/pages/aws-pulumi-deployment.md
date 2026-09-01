---
title: AWS ECS & Pulumi Deployment Guide
created: 2026-08-31
updated: 2026-08-31
tags: deployment, aws, ecs, fargate, pulumi, alb
---

# AWS ECS & Pulumi Deployment Guide

This document provides complete operational and architectural documentation for the **Creole Knowledge Portal** deployment on AWS ECS Fargate orchestrated via Pulumi.

---

## 1. Architecture Overview

```mermaid
graph TD
    Client[Client Browser / API Client] -->|HTTPS| CF[AWS CloudFront Distribution: dxad42dnfuckt.cloudfront.net]
    CF -->|HTTP /creole-knowledge-portal/*| ALB[Shared Application Load Balancer]
    ALB -->|/creole-knowledge-portal/api/v1/*| APITG[API Target Group :8000]
    ALB -->|/creole-knowledge-portal/*| WebTG[Web Target Group :3000]
    APITG --> APISvc[FastAPI ECS Service - Port 8000]
    WebTG --> WebSvc[Next.js 15 Standalone ECS Service - Port 3000]
    WorkersSvc[Celery Workers ECS Service] --> Redis[(Redis Cloud)]
    APISvc --> Redis
    APISvc --> MongoDB[(MongoDB Atlas)]
    APISvc --> Supabase[(Supabase DB & Auth)]
    WebSvc --> Supabase
```

---

## 2. Infrastructure Details

| Component | Resource Details |
| :--- | :--- |
| **AWS Region** | `us-east-1` |
| **AWS Account ID** | `642024554221` (Sandbox Account) |
| **Pulumi Org/Stack** | `YashCreole/creole-knowledge-portal/dev` |
| **CloudFront Distribution** | `dxad42dnfuckt.cloudfront.net` |
| **ECS Cluster** | `ckp-shared` |
| **Application Load Balancer** | `ckp-shared-alb-27687108.us-east-1.elb.amazonaws.com` |
| **ECR Repositories** | `642024554221.dkr.ecr.us-east-1.amazonaws.com/creole-knowledge-portal-*` |
| **CloudWatch Log Group** | `creole-knowledge-portal-logs-b8272d8` |

---

## 3. Endpoints (CloudFront HTTPS)

The application is deployed behind an AWS CloudFront distribution terminating TLS and forwarding requests to the ALB:

- **Web Application (CloudFront HTTPS)**:
  `https://dxad42dnfuckt.cloudfront.net/creole-knowledge-portal`
- **FastAPI Liveness Health Check**:
  `https://dxad42dnfuckt.cloudfront.net/creole-knowledge-portal/api/v1/health/live`
- **FastAPI Full Readiness Probe**:
  `https://dxad42dnfuckt.cloudfront.net/creole-knowledge-portal/api/v1/health/ready`
- **Direct ALB HTTP Fallback**:
  `http://ckp-shared-alb-27687108.us-east-1.elb.amazonaws.com/creole-knowledge-portal`

---

## 4. Container Configuration

1. **Next.js Web**:
   - Multi-stage Docker build utilizing Next.js `output: 'standalone'`.
   - Base path configured via `basePath: '/creole-knowledge-portal'` and `assetPrefix: '/creole-knowledge-portal'`.
2. **FastAPI Backend**:
   - Python 3.11 with `uv` package manager.
   - Dual route mounting (`/api/v1` and `/creole-knowledge-portal/api/v1`) for local and ALB compatibility.
   - MongoDB Atlas TLS configured with `certifi.where()`.
3. **Celery Worker**:
   - Prefork concurrency connected to Redis queue for background blog scraping and AI synthesis.
