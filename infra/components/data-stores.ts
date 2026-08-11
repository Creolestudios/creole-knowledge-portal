/**
 * CKP data-store placeholders — Option 3 dedicated databases in shared VPC.
 *
 * Full ElastiCache / DocumentDB provisioning is deferred; this module documents
 * the intended security-group wiring and exports config-driven connection hints.
 * See infra/README.md for Atlas/external Mongo alternatives.
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface DataStoreInputs {
  appName: string;
  environment: string;
  vpcId: pulumi.Input<string>;
  privateSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  vpcCidrBlock: pulumi.Input<string>;
  fargateSecurityGroupId: pulumi.Input<string>;
  provider: aws.Provider;
  tags: Record<string, string>;
}

export interface DataStoreOutputs {
  /** Placeholder — set via Pulumi config until ElastiCache is implemented. */
  redisUrl: pulumi.Output<string>;
  /** Placeholder — set via Pulumi config until DocumentDB/Atlas is wired. */
  mongoUri: pulumi.Output<string>;
  redisSecurityGroupId?: pulumi.Output<string>;
  mongoSecurityGroupId?: pulumi.Output<string>;
}

export function createDataStorePlaceholders(
  inputs: DataStoreInputs
): DataStoreOutputs {
  const config = new pulumi.Config("ckp");
  const redisUrlOverride = config.get("redisUrl");
  const mongoUriOverride = config.getSecret("mongoUri");

  // Security groups reserved for future ElastiCache + DocumentDB clusters.
  const redisSg = new aws.ec2.SecurityGroup(
    `${inputs.appName}-redis-sg`,
    {
      vpcId: inputs.vpcId,
      description: "Allow Redis from CKP Fargate tasks (ElastiCache placeholder)",
      ingress: [
        {
          protocol: "tcp",
          fromPort: 6379,
          toPort: 6379,
          securityGroups: [inputs.fargateSecurityGroupId],
        },
      ],
      egress: [
        {
          protocol: "-1",
          fromPort: 0,
          toPort: 0,
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
      tags: {
        Name: `${inputs.appName}-redis-sg-${inputs.environment}`,
        Component: "cache",
        ...inputs.tags,
      },
    },
    { provider: inputs.provider }
  );

  const mongoSg = new aws.ec2.SecurityGroup(
    `${inputs.appName}-mongo-sg`,
    {
      vpcId: inputs.vpcId,
      description: "Allow MongoDB from CKP Fargate tasks (DocumentDB placeholder)",
      ingress: [
        {
          protocol: "tcp",
          fromPort: 27017,
          toPort: 27017,
          securityGroups: [inputs.fargateSecurityGroupId],
        },
      ],
      egress: [
        {
          protocol: "-1",
          fromPort: 0,
          toPort: 0,
          cidrBlocks: ["0.0.0.0/0"],
        },
      ],
      tags: {
        Name: `${inputs.appName}-mongo-sg-${inputs.environment}`,
        Component: "database",
        ...inputs.tags,
      },
    },
    { provider: inputs.provider }
  );

  // TODO: aws.elasticache.ReplicationGroup for Redis
  // TODO: aws.docdb.Cluster for Mongo-compatible DocumentDB (or Atlas + VPC endpoint)

  const redisUrl = redisUrlOverride
    ? pulumi.output(redisUrlOverride)
    : pulumi.output("redis://placeholder:6379/0");

  const mongoUri = mongoUriOverride
    ? pulumi.secret(mongoUriOverride)
    : pulumi.secret("mongodb://placeholder:27017/ckp");

  return {
    redisUrl,
    mongoUri,
    redisSecurityGroupId: redisSg.id,
    mongoSecurityGroupId: mongoSg.id,
  };
}
