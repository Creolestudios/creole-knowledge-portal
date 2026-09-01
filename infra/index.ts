import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { createAppSecrets } from "./components/app-secrets";
import { createDataStorePlaceholders } from "./components/data-stores";
import { createSharedPlatform } from "./components/platform";

const config = new pulumi.Config("ckp");
const projectConfig = new pulumi.Config();
const awsConfig = new pulumi.Config("aws");

const appName = config.get("appName") ?? "creole-knowledge-portal";
const environment = config.get("environment") ?? pulumi.getStack();
const owner = projectConfig.get("owner") ?? "CKP-Team";
const awsRegion = (awsConfig.get("region") ?? "us-east-1") as aws.Region;

// Default VPC is AWS-owned (looked up). ALB/cluster/SG/OIDC are Pulumi-managed (imported).
const defaultVpc = aws.ec2.getVpcOutput({ default: true });
const sharedVpcId = defaultVpc.id;
const sharedVpcCidrBlock = defaultVpc.cidrBlock;
const githubRepo = config.get("githubRepo") ?? "Creolestudios/creole-knowledge-portal";
const defaultSubnets = aws.ec2.getSubnetsOutput({
  filters: [{ name: "vpc-id", values: [defaultVpc.id] }],
});
const albSubnetIds =
  config.getObject<string[]>("albSubnetIds") ?? defaultSubnets.ids;

const webPort = config.getNumber("webPort") ?? 3000;
const apiPort = config.getNumber("apiPort") ?? 8000;
const listenerPriorityBase = config.getNumber("listenerPriorityBase") ?? 1000;
const desiredCount = config.getNumber("ecsDesiredCount") ?? 1;
const webDesiredCount = config.getNumber("webDesiredCount") ?? desiredCount;
const apiDesiredCount = config.getNumber("apiDesiredCount") ?? desiredCount;
const cpu = config.get("ecsCpu") ?? "1024";
const memory = config.get("ecsMemory") ?? "2048";

const webImage = config.get("webImage");
const apiImage = config.get("apiImage");
const workersImage = config.get("workersImage");
const domainName = config.get("domainName") ?? "ckp.nikcreations.com";

export const defaultTags = {
  Project: appName,
  Environment: environment,
  Lifecycle: "ephemeral",
  Owner: owner,
  ManagedBy: "Pulumi",
  Stack: pulumi.getStack(),
};

const awsProvider = new aws.Provider("aws-provider", {
  region: awsRegion,
  defaultTags: { tags: defaultTags },
});

const platform = createSharedPlatform({
  appName,
  environment,
  vpcId: sharedVpcId,
  publicSubnetIds: albSubnetIds,
  githubRepo,
  provider: awsProvider,
  tags: defaultTags,
});

const sharedAlbSecurityGroupId = platform.albSg.id;
const sharedAlbListenerArn = platform.httpListener.arn;
const sharedAlbDnsName = platform.alb.dnsName;
const sharedEcsClusterArn = platform.cluster.arn;
const sharedEcsClusterName = platform.cluster.name;
const sharedPrivateSubnetIds = albSubnetIds;

const fargateSg = new aws.ec2.SecurityGroup(
  `${appName}-fargate-sg`,
  {
    vpcId: sharedVpcId,
    description: "Allow CKP web and API traffic from shared ALB",
    ingress: [
      {
        protocol: "tcp",
        fromPort: webPort,
        toPort: webPort,
        securityGroups: [sharedAlbSecurityGroupId],
      },
      {
        protocol: "tcp",
        fromPort: apiPort,
        toPort: apiPort,
        securityGroups: [sharedAlbSecurityGroupId],
      },
    ],
    egress: [
      { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
    ],
    tags: { Name: `${appName}-fargate-sg-${environment}`, Component: "compute", ...defaultTags },
  },
  { provider: awsProvider }
);

const dataStores = createDataStorePlaceholders({
  appName,
  environment,
  vpcId: sharedVpcId,
  privateSubnetIds: sharedPrivateSubnetIds,
  vpcCidrBlock: sharedVpcCidrBlock,
  fargateSecurityGroupId: fargateSg.id,
  provider: awsProvider,
  tags: defaultTags,
});

const appSecrets = createAppSecrets({
  appName,
  environment,
  provider: awsProvider,
  tags: defaultTags,
});

const basePath = `/${appName}`;

const webRepo = new aws.ecr.Repository(`${appName}-web-repo`, {
  name: `${appName}-web`,
  forceDelete: environment !== "prod",
  imageScanningConfiguration: { scanOnPush: true },
  tags: { Name: `${appName}-web-${environment}`, Component: "registry", ...defaultTags },
}, { provider: awsProvider });

const apiRepo = new aws.ecr.Repository(`${appName}-api-repo`, {
  name: `${appName}-api`,
  forceDelete: environment !== "prod",
  imageScanningConfiguration: { scanOnPush: true },
  tags: { Name: `${appName}-api-${environment}`, Component: "registry", ...defaultTags },
}, { provider: awsProvider });

const workersRepo = new aws.ecr.Repository(`${appName}-workers-repo`, {
  name: `${appName}-workers`,
  forceDelete: environment !== "prod",
  imageScanningConfiguration: { scanOnPush: true },
  tags: { Name: `${appName}-workers-${environment}`, Component: "registry", ...defaultTags },
}, { provider: awsProvider });

const albTargetGroupName = (suffix: string) => `ckp-${environment}-${suffix}`.slice(0, 32);

const resolvedWebImage = webImage ?? pulumi.interpolate`${webRepo.repositoryUrl}:latest`;
const resolvedApiImage = apiImage ?? pulumi.interpolate`${apiRepo.repositoryUrl}:latest`;
const resolvedWorkersImage = workersImage ?? pulumi.interpolate`${workersRepo.repositoryUrl}:latest`;

const webTg = new aws.lb.TargetGroup(`${appName}-web-tg`, {
  name: albTargetGroupName("web"),
  port: webPort,
  protocol: "HTTP",
  targetType: "ip",
  vpcId: sharedVpcId,
  healthCheck: { path: basePath, matcher: "200-399" },
  tags: { Name: `${appName}-web-tg-${environment}`, Component: "routing", ...defaultTags },
}, { provider: awsProvider });

const apiTg = new aws.lb.TargetGroup(`${appName}-api-tg`, {
  name: albTargetGroupName("api"),
  port: apiPort,
  protocol: "HTTP",
  targetType: "ip",
  vpcId: sharedVpcId,
  healthCheck: { path: "/api/v1/health/live", matcher: "200-399" },
  tags: { Name: `${appName}-api-tg-${environment}`, Component: "routing", ...defaultTags },
}, { provider: awsProvider });

new aws.lb.ListenerRule(`${appName}-api-rule`, {
  listenerArn: sharedAlbListenerArn,
  priority: listenerPriorityBase,
  actions: [{ type: "forward", targetGroupArn: apiTg.arn }],
  conditions: [{ pathPattern: { values: [`/${appName}/api/v1/*`, `/${appName}/api/v1`] } }],
  tags: { Name: `${appName}-api-rule-${environment}`, Component: "routing", ...defaultTags },
}, { provider: awsProvider });

new aws.lb.ListenerRule(`${appName}-web-rule`, {
  listenerArn: sharedAlbListenerArn,
  priority: listenerPriorityBase + 1,
  actions: [{ type: "forward", targetGroupArn: webTg.arn }],
  conditions: [
    { pathPattern: { values: [`/${appName}/*`, `/${appName}`] } },
  ],
  tags: { Name: `${appName}-web-rule-${environment}`, Component: "routing", ...defaultTags },
}, { provider: awsProvider });

const apiPublicUrl = pulumi.interpolate`http://${platform.alb.dnsName}/${appName}`;
const blogServiceUrl = pulumi.interpolate`${apiPublicUrl}/api/v1`;
const webOrigin = pulumi.interpolate`http://${platform.alb.dnsName}`;

const executionRole = new aws.iam.Role(`${appName}-ecs-exec-role`, {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "ecs-tasks.amazonaws.com",
  }),
  tags: { Name: `${appName}-ecs-exec-${environment}`, Component: "iam", ...defaultTags },
}, { provider: awsProvider });

new aws.iam.RolePolicyAttachment(`${appName}-ecs-exec-policy`, {
  role: executionRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
}, { provider: awsProvider });

if (appSecrets.allArns.length > 0) {
  new aws.iam.RolePolicy(
    `${appName}-ecs-secrets-policy`,
    {
      role: executionRole.id,
      policy: pulumi.all(appSecrets.allArns).apply((arns) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["secretsmanager:GetSecretValue"],
              Resource: arns,
            },
          ],
        })
      ),
    },
    { provider: awsProvider }
  );
}

type EcsEnvVar = { name: string; value: string };
type EcsSecretRef = { name: string; valueFrom: string };

function envOrSecret(
  envName: string,
  secretArn: string | undefined,
  fallback: string,
  env: EcsEnvVar[],
  secrets: EcsSecretRef[]
): void {
  if (secretArn) {
    secrets.push({ name: envName, valueFrom: secretArn });
  } else {
    env.push({ name: envName, value: fallback });
  }
}

/**
 * Builds the Mongo/Redis/Celery env-or-secret entries shared by the API and
 * worker task definitions, plus Gemini and Supabase secrets FastAPI needs.
 */
function buildCeleryEnvSecrets(
  mongoArn: string | undefined,
  redisArn: string | undefined,
  llmArn: string | undefined,
  mongoFallback: string,
  redisFallback: string,
  env: EcsEnvVar[],
  secrets: EcsSecretRef[],
  supabase?: {
    urlArn?: string;
    anonArn?: string;
    serviceArn?: string;
  }
): void {
  envOrSecret("MONGO_URI", mongoArn, mongoFallback, env, secrets);
  envOrSecret("REDIS_URL", redisArn, redisFallback, env, secrets);
  envOrSecret("REDIS_RESULT_URL", redisArn, redisFallback, env, secrets);
  envOrSecret("CELERY_BROKER_URL", redisArn, redisFallback, env, secrets);
  if (llmArn) {
    secrets.push({ name: "LLM_GEMINI_API_KEY", valueFrom: llmArn });
    secrets.push({ name: "GEMINI_API_KEY", valueFrom: llmArn });
  }
  if (supabase?.urlArn) {
    secrets.push({ name: "SUPABASE_URL", valueFrom: supabase.urlArn });
    secrets.push({ name: "NEXT_PUBLIC_SUPABASE_URL", valueFrom: supabase.urlArn });
  }
  if (supabase?.anonArn) {
    secrets.push({ name: "SUPABASE_ANON_KEY", valueFrom: supabase.anonArn });
    secrets.push({ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", valueFrom: supabase.anonArn });
  }
  if (supabase?.serviceArn) {
    secrets.push({ name: "SUPABASE_SERVICE_ROLE_KEY", valueFrom: supabase.serviceArn });
    secrets.push({ name: "SERVICE_ROLE_KEY", valueFrom: supabase.serviceArn });
  }
}

const logGroup = new aws.cloudwatch.LogGroup(`${appName}-logs`, {
  retentionInDays: environment === "prod" ? 30 : 3,
  tags: { Name: `${appName}-logs-${environment}`, Component: "logs", ...defaultTags },
}, { provider: awsProvider });

const apiTask = new aws.ecs.TaskDefinition(`${appName}-api-task`, {
  family: `${appName}-api`,
  cpu,
  memory,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: executionRole.arn,
  containerDefinitions: pulumi
    .all([
      resolvedApiImage,
      logGroup.name,
      dataStores.mongoUri,
      dataStores.redisUrl,
      appSecrets.mongoUri?.arn ?? pulumi.output(""),
      appSecrets.redisUrl?.arn ?? pulumi.output(""),
      appSecrets.llmGeminiApiKey?.arn ?? pulumi.output(""),
      appSecrets.supabaseUrl?.arn ?? pulumi.output(""),
      appSecrets.supabaseAnonKey?.arn ?? pulumi.output(""),
      appSecrets.supabaseServiceRoleKey?.arn ?? pulumi.output(""),
      pulumi.interpolate`${webOrigin},http://localhost:3000`,
    ])
    .apply(([image, log, mongoFallback, redisFallback, mongoArn, redisArn, llmArn, supaUrlArn, supaAnonArn, supaServiceArn, corsOrigins]) => {
      const environment: EcsEnvVar[] = [
        { name: "NODE_ENV", value: "production" },
        { name: "HOSTNAME", value: "0.0.0.0" },
        { name: "PORT", value: String(apiPort) },
        { name: "APP_ENVIRONMENT", value: "production" },
        { name: "APP_CORS_ORIGINS", value: corsOrigins },
        { name: "APP_ROOT_PATH", value: basePath },
      ];
      const secrets: EcsSecretRef[] = [];
      buildCeleryEnvSecrets(
        mongoArn || undefined,
        redisArn || undefined,
        llmArn || undefined,
        mongoFallback,
        redisFallback,
        environment,
        secrets,
        {
          urlArn: supaUrlArn || undefined,
          anonArn: supaAnonArn || undefined,
          serviceArn: supaServiceArn || undefined,
        }
      );
      return JSON.stringify([
        {
          name: "api",
          image,
          portMappings: [{ containerPort: apiPort, hostPort: apiPort }],
          environment,
          secrets: secrets.length > 0 ? secrets : undefined,
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": log,
              "awslogs-region": awsRegion,
              "awslogs-stream-prefix": "api",
            },
          },
        },
      ]);
    }),
  tags: { Name: `${appName}-api-task-${environment}`, Component: "compute", ...defaultTags },
}, { provider: awsProvider });

const webTask = new aws.ecs.TaskDefinition(`${appName}-web-task`, {
  family: `${appName}-web`,
  cpu,
  memory,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: executionRole.arn,
  containerDefinitions: pulumi
    .all([
      resolvedWebImage,
      logGroup.name,
      apiPublicUrl,
      blogServiceUrl,
      appSecrets.supabaseUrl?.arn ?? pulumi.output(""),
      appSecrets.supabaseAnonKey?.arn ?? pulumi.output(""),
      appSecrets.supabaseServiceRoleKey?.arn ?? pulumi.output(""),
      appSecrets.geminiApiKey?.arn ?? pulumi.output(""),
    ])
    .apply(([image, log, apiUrl, blogUrl, supaUrlArn, supaAnonArn, supaServiceArn, geminiArn]) => {
      const environment: EcsEnvVar[] = [
        { name: "NODE_ENV", value: "production" },
        { name: "HOSTNAME", value: "0.0.0.0" },
        { name: "PORT", value: String(webPort) },
        { name: "NEXT_PUBLIC_API_URL", value: apiUrl },
        { name: "NEXT_PUBLIC_BASE_PATH", value: basePath },
        { name: "BLOG_SERVICE_URL", value: blogUrl },
      ];
      const secrets: EcsSecretRef[] = [];
      if (supaUrlArn) secrets.push({ name: "NEXT_PUBLIC_SUPABASE_URL", valueFrom: supaUrlArn });
      if (supaAnonArn) secrets.push({ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", valueFrom: supaAnonArn });
      if (supaServiceArn) secrets.push({ name: "SUPABASE_SERVICE_ROLE_KEY", valueFrom: supaServiceArn });
      if (geminiArn) secrets.push({ name: "GEMINI_API_KEY", valueFrom: geminiArn });
      return JSON.stringify([
        {
          name: "web",
          image,
          portMappings: [{ containerPort: webPort, hostPort: webPort }],
          environment,
          secrets: secrets.length > 0 ? secrets : undefined,
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": log,
              "awslogs-region": awsRegion,
              "awslogs-stream-prefix": "web",
            },
          },
        },
      ]);
    }),
  tags: { Name: `${appName}-web-task-${environment}`, Component: "compute", ...defaultTags },
}, { provider: awsProvider });

// Celery workers — no ALB attachment; scale independently.
const workersTask = new aws.ecs.TaskDefinition(`${appName}-workers-task`, {
  family: `${appName}-workers`,
  cpu,
  memory,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: executionRole.arn,
  containerDefinitions: pulumi
    .all([
      resolvedWorkersImage,
      logGroup.name,
      dataStores.mongoUri,
      dataStores.redisUrl,
      appSecrets.mongoUri?.arn ?? pulumi.output(""),
      appSecrets.redisUrl?.arn ?? pulumi.output(""),
      appSecrets.llmGeminiApiKey?.arn ?? pulumi.output(""),
      appSecrets.supabaseUrl?.arn ?? pulumi.output(""),
      appSecrets.supabaseAnonKey?.arn ?? pulumi.output(""),
      appSecrets.supabaseServiceRoleKey?.arn ?? pulumi.output(""),
    ])
    .apply(([image, log, mongoFallback, redisFallback, mongoArn, redisArn, llmArn, supaUrlArn, supaAnonArn, supaServiceArn]) => {
      const environment: EcsEnvVar[] = [
        { name: "NODE_ENV", value: "production" },
        { name: "APP_ENVIRONMENT", value: "production" },
      ];
      const secrets: EcsSecretRef[] = [];
      buildCeleryEnvSecrets(
        mongoArn || undefined,
        redisArn || undefined,
        llmArn || undefined,
        mongoFallback,
        redisFallback,
        environment,
        secrets,
        {
          urlArn: supaUrlArn || undefined,
          anonArn: supaAnonArn || undefined,
          serviceArn: supaServiceArn || undefined,
        }
      );
      return JSON.stringify([
        {
          name: "workers",
          image,
          command: [
            "celery",
            "-A",
            "src.workers.celery_app",
            "worker",
            "-Q",
            "scrape_queue,extract_queue,rank_queue,generate_queue,publish_queue",
            "--loglevel=info",
            "--time-limit=700",
          ],
          environment,
          secrets: secrets.length > 0 ? secrets : undefined,
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": log,
              "awslogs-region": awsRegion,
              "awslogs-stream-prefix": "workers",
            },
          },
        },
      ]);
    }),
  tags: { Name: `${appName}-workers-task-${environment}`, Component: "compute", ...defaultTags },
}, { provider: awsProvider });

new aws.ecs.Service(`${appName}-api-service`, {
  cluster: sharedEcsClusterArn,
  taskDefinition: apiTask.arn,
  desiredCount: apiDesiredCount,
  launchType: "FARGATE",
  networkConfiguration: {
    subnets: sharedPrivateSubnetIds,
    securityGroups: [fargateSg.id],
    assignPublicIp: true,
  },
  loadBalancers: [
    { targetGroupArn: apiTg.arn, containerName: "api", containerPort: apiPort },
  ],
  tags: { Name: `${appName}-api-service-${environment}`, Component: "compute", ...defaultTags },
}, { provider: awsProvider, dependsOn: [apiTg] });

new aws.ecs.Service(`${appName}-web-service`, {
  cluster: sharedEcsClusterArn,
  taskDefinition: webTask.arn,
  desiredCount: webDesiredCount,
  launchType: "FARGATE",
  networkConfiguration: {
    subnets: sharedPrivateSubnetIds,
    securityGroups: [fargateSg.id],
    assignPublicIp: true,
  },
  loadBalancers: [
    { targetGroupArn: webTg.arn, containerName: "web", containerPort: webPort },
  ],
  tags: { Name: `${appName}-web-service-${environment}`, Component: "compute", ...defaultTags },
}, { provider: awsProvider, dependsOn: [webTg] });

new aws.ecs.Service(`${appName}-workers-service`, {
  cluster: sharedEcsClusterArn,
  taskDefinition: workersTask.arn,
  desiredCount: config.getNumber("workersDesiredCount") ?? 1,
  launchType: "FARGATE",
  networkConfiguration: {
    subnets: sharedPrivateSubnetIds,
    securityGroups: [fargateSg.id],
    assignPublicIp: true,
  },
  tags: { Name: `${appName}-workers-service-${environment}`, Component: "compute", ...defaultTags },
}, { provider: awsProvider });


const cloudfrontOriginId = `${appName}-alb-origin`;
const cloudfrontDistribution = new aws.cloudfront.Distribution(
  `${appName}-cdn`,
  {
    enabled: true,
    isIpv6Enabled: true,
    comment: `CloudFront for ${appName} (${environment})`,
    priceClass: "PriceClass_100",
    origins: [
      {
        domainName: platform.alb.dnsName,
        originId: cloudfrontOriginId,
        customOriginConfig: {
          httpPort: 80,
          httpsPort: 443,
          originProtocolPolicy: "http-only",
          originSslProtocols: ["TLSv1.2"],
          originReadTimeout: 60,
          originKeepaliveTimeout: 60,
        },
      },
    ],
    defaultCacheBehavior: {
      targetOriginId: cloudfrontOriginId,
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
      cachedMethods: ["GET", "HEAD", "OPTIONS"],
      defaultTtl: 0,
      minTtl: 0,
      maxTtl: 0,
      forwardedValues: {
        queryString: true,
        cookies: { forward: "all" },
        headers: [
          "Accept",
          "Accept-Encoding",
          "Accept-Language",
          "Authorization",
          "Referer",
          "User-Agent",
          "x-forwarded-host",
          "x-forwarded-proto",
        ],
      },
    },
    restrictions: {
      geoRestriction: {
        restrictionType: "none",
      },
    },
    viewerCertificate: {
      cloudfrontDefaultCertificate: true,
    },
    tags: { Name: `${appName}-cdn-${environment}`, Component: "cdn", ...defaultTags },
  },
  { provider: awsProvider }
);

export const projectTag = appName;
export const environmentName = environment;
export const webRepositoryUrl = webRepo.repositoryUrl;
export const apiRepositoryUrl = apiRepo.repositoryUrl;
export const workersRepositoryUrl = workersRepo.repositoryUrl;
export const directAlbHttpUrl = pulumi.interpolate`http://${platform.alb.dnsName}/${appName}`;
export const cloudFrontDomain = cloudfrontDistribution.domainName;
export const cloudFrontUrl = pulumi.interpolate`https://${cloudfrontDistribution.domainName}/${appName}`;
export const applicationUrl = cloudFrontUrl;
export const apiUrl = pulumi.interpolate`https://${cloudfrontDistribution.domainName}/${appName}/api/v1`;
export const ecsClusterArn = sharedEcsClusterArn;
export const ecsClusterName = sharedEcsClusterName;
export const appSecurityGroupId = fargateSg.id;
export const redisSecurityGroupId = dataStores.redisSecurityGroupId;
export const mongoSecurityGroupId = dataStores.mongoSecurityGroupId;
export const sharedAlbArn = platform.alb.arn;
export const sharedAlbDnsNameOutput = platform.alb.dnsName;
export const githubDeployRoleArn = platform.deployRole.arn;
export const githubOidcProviderArn = platform.oidcProvider.arn;


