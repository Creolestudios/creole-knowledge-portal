/**
 * AWS Secrets Manager resources for CKP ECS tasks.
 * Values are sourced from Pulumi encrypted config (`pulumi config set --secret`).
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface AppSecretsInputs {
  appName: string;
  environment: string;
  provider: aws.Provider;
  tags: Record<string, string>;
}

export interface ManagedSecret {
  arn: pulumi.Output<string>;
  name: string;
}

export interface AppSecretsOutputs {
  supabaseUrl: ManagedSecret | undefined;
  supabaseAnonKey: ManagedSecret | undefined;
  supabaseServiceRoleKey: ManagedSecret | undefined;
  geminiApiKey: ManagedSecret | undefined;
  llmGeminiApiKey: ManagedSecret | undefined;
  mongoUri: ManagedSecret | undefined;
  redisUrl: ManagedSecret | undefined;
  /** All created secret ARNs — used for execution-role IAM policy. */
  allArns: pulumi.Output<string>[];
}

function createManagedSecret(
  resourceName: string,
  secretPath: string,
  value: pulumi.Input<string> | undefined,
  inputs: AppSecretsInputs
): ManagedSecret | undefined {
  if (value === undefined) {
    return undefined;
  }

  const secret = new aws.secretsmanager.Secret(
    resourceName,
    {
      name: secretPath,
      description: `CKP ${inputs.environment} — ${resourceName}`,
      tags: {
        Name: secretPath,
        Component: "secrets",
        ...inputs.tags,
      },
    },
    { provider: inputs.provider }
  );

  new aws.secretsmanager.SecretVersion(
    `${resourceName}-version`,
    {
      secretId: secret.id,
      secretString: value,
    },
    { provider: inputs.provider }
  );

  return { arn: secret.arn, name: secretPath };
}

/** ECS `secrets` entry for a plain-string Secrets Manager secret. */
export function ecsSecret(envName: string, secret: ManagedSecret): { name: string; valueFrom: pulumi.Output<string> } {
  return { name: envName, valueFrom: secret.arn };
}

export function createAppSecrets(inputs: AppSecretsInputs): AppSecretsOutputs {
  const config = new pulumi.Config("ckp");
  const prefix = `${inputs.appName}/${inputs.environment}`;

  const supabaseUrl = createManagedSecret(
    `${inputs.appName}-supabase-url`,
    `${prefix}/supabase-url`,
    config.get("supabaseUrl"),
    inputs
  );

  const supabaseAnonKey = createManagedSecret(
    `${inputs.appName}-supabase-anon-key`,
    `${prefix}/supabase-anon-key`,
    config.getSecret("supabaseAnonKey"),
    inputs
  );

  const supabaseServiceRoleKey = createManagedSecret(
    `${inputs.appName}-supabase-service-role-key`,
    `${prefix}/supabase-service-role-key`,
    config.getSecret("supabaseServiceRoleKey"),
    inputs
  );

  const geminiApiKey = createManagedSecret(
    `${inputs.appName}-gemini-api-key`,
    `${prefix}/gemini-api-key`,
    config.getSecret("geminiApiKey"),
    inputs
  );

  const llmGeminiKeyValue = config.getSecret("llmGeminiApiKey") ?? config.getSecret("geminiApiKey");
  const llmGeminiApiKey = createManagedSecret(
    `${inputs.appName}-llm-gemini-api-key`,
    `${prefix}/llm-gemini-api-key`,
    llmGeminiKeyValue,
    inputs
  );

  const mongoUri = createManagedSecret(
    `${inputs.appName}-mongo-uri`,
    `${prefix}/mongo-uri`,
    config.getSecret("mongoUri"),
    inputs
  );

  const redisUrlValue = config.get("redisUrl");
  const redisUrl = createManagedSecret(
    `${inputs.appName}-redis-url`,
    `${prefix}/redis-url`,
    redisUrlValue ? pulumi.output(redisUrlValue) : undefined,
    inputs
  );

  const allArns = [
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    geminiApiKey,
    llmGeminiApiKey,
    mongoUri,
    redisUrl,
  ]
    .filter((s): s is ManagedSecret => s !== undefined)
    .map((s) => s.arn);

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    geminiApiKey,
    llmGeminiApiKey,
    mongoUri,
    redisUrl,
    allArns,
  };
}
