import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface PlatformArgs {
  appName: string;
  environment: string;
  vpcId: pulumi.Input<string>;
  publicSubnetIds: pulumi.Input<string[]>;
  githubRepo: string;
  provider: aws.Provider;
  tags: Record<string, string>;
}

/**
 * Shared compute/network that used to be AWS CLI bootstrap.
 * Existing resources are imported into this stack — do not recreate.
 */
export function createSharedPlatform(args: PlatformArgs) {
  const { appName, environment, vpcId, publicSubnetIds, githubRepo, provider, tags } = args;
  const protect = { protect: false, provider };

  const albSg = new aws.ec2.SecurityGroup(
    "ckp-shared-alb-sg",
    {
      name: "ckp-shared-alb-sg",
      vpcId,
      description: "CKP shared internet-facing ALB",
      ingress: [
        { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
        { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
      ],
      egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
      tags: { Name: "ckp-shared-alb-sg", ...tags },
    },
    protect
  );

  const alb = new aws.lb.LoadBalancer(
    "ckp-shared-alb",
    {
      name: "ckp-shared-alb",
      loadBalancerType: "application",
      internal: false,
      ipAddressType: "ipv4",
      securityGroups: [albSg.id],
      subnets: publicSubnetIds,
      tags: { Name: "ckp-shared-alb", ...tags },
    },
    protect
  );

  const httpListener = new aws.lb.Listener(
    "ckp-shared-http-listener",
    {
      loadBalancerArn: alb.arn,
      port: 80,
      protocol: "HTTP",
      defaultActions: [
        {
          type: "fixed-response",
          fixedResponse: {
            contentType: "text/plain",
            messageBody: "Not Found",
            statusCode: "404",
          },
        },
      ],
      tags: { Name: `ckp-shared-http-${environment}`, Component: "routing", ...tags },
    },
    protect
  );

  const cluster = new aws.ecs.Cluster(
    "ckp-shared-cluster",
    {
      name: "ckp-shared",
      tags: { Name: "ckp-shared", ...tags },
    },
    protect
  );

  const oidcProvider = new aws.iam.OpenIdConnectProvider(
    "ckp-github-oidc",
    {
      url: "https://token.actions.githubusercontent.com",
      clientIdLists: ["sts.amazonaws.com"],
      thumbprintLists: ["6938fd4d98bab03fa0217a5d6397dd4a4f5e5e5e"],
      tags: { Name: "ckp-github-oidc", ...tags },
    },
    protect
  );

  const deployRole = new aws.iam.Role(
    "ckp-github-deploy-role",
    {
      name: `ckp-github-deploy-${environment}`,
      description: "GitHub Actions OIDC deploy role for CKP Pulumi",
      assumeRolePolicy: oidcProvider.arn.apply((oidcArn) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { Federated: oidcArn },
              Action: "sts:AssumeRoleWithWebIdentity",
              Condition: {
                StringEquals: {
                  "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                },
                StringLike: {
                  "token.actions.githubusercontent.com:sub": `repo:${githubRepo}:*`,
                },
              },
            },
          ],
        })
      ),
      tags: { Name: `ckp-github-deploy-${environment}`, ...tags },
    },
    protect
  );

  const deployPolicy = new aws.iam.RolePolicy(
    "ckp-github-deploy-policy",
    {
      name: "ckp-pulumi-deploy",
      role: deployRole.id,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "ec2:*",
              "ecs:*",
              "ecr:*",
              "elasticloadbalancing:*",
              "cloudfront:*",
              "route53:*",
              "acm:*",
              "secretsmanager:*",
              "logs:*",
              "iam:GetRole",
              "iam:CreateRole",
              "iam:DeleteRole",
              "iam:PutRolePolicy",
              "iam:DeleteRolePolicy",
              "iam:AttachRolePolicy",
              "iam:DetachRolePolicy",
              "iam:PassRole",
              "iam:ListRolePolicies",
              "iam:ListAttachedRolePolicies",
              "iam:GetRolePolicy",
              "iam:TagRole",
              "iam:UntagRole",
              "s3:GetObject",
              "s3:PutObject",
              "s3:DeleteObject",
              "s3:ListBucket",
              "kms:Decrypt",
              "kms:Encrypt",
              "kms:GenerateDataKey",
              "kms:DescribeKey",
            ],
            Resource: "*",
          },
        ],
      }),
    },
    protect
  );

  return {
    albSg,
    alb,
    httpListener,
    cluster,
    oidcProvider,
    deployRole,
    deployPolicy,
    appName,
  };
}
