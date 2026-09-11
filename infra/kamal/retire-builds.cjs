// Executed with the candidate tools image's tsx loader. No new gate policy or fabricated ECS ARN.
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('./src/generated/prisma/client');
const { resolveDeploymentIdentity } = require('@watchdog-bms/config');
const { retireLaunchBuilds } = require('./src/modules/feature-launch/application/retire-launch-builds');
(async () => {
  const proof = JSON.parse(process.env.KAMAL_RETIRE_PROOF);
  const deployment = resolveDeploymentIdentity(process.env);
  if (!/^[0-9a-f]{40}$/.test(deployment.buildReleaseId) || proof.sourceCommit !== deployment.buildReleaseId
      || proof.environment !== deployment.targetEnvironment || !/^[0-9TZ-]+-[0-9a-f]{8}$/.test(proof.operationId)
      || JSON.stringify(Object.keys(proof.services).sort()) !== JSON.stringify(['ai-gateway', 'api-web', 'workers'])) {
    throw new Error('invalid_kamal_retirement_proof');
  }
  for (const rows of Object.values(proof.services)) {
    if (!Array.isArray(rows) || !rows.length || rows.some(r => r.running !== true || r.sourceCommit !== proof.sourceCommit
        || !/^[0-9a-f]{64}$/.test(r.containerId) || !/^i-[0-9a-f]+$/.test(r.instanceId))) {
      throw new Error('incomplete_kamal_runtime_observation');
    }
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const result = await retireLaunchBuilds({ client }, {
      activeBuilds: [proof.sourceCommit], deployment, requestId: 'kamal-' + proof.operationId,
      // Existing audit field name is retained; value identifies the real Kamal operation.
      deploymentArn: `urn:mangmee:kamal:${proof.environment}:${proof.operationId}`,
      mode: proof.mode === 'reconcile' ? 'reconcile' : 'retire',
    });
    console.log(JSON.stringify({ passed: true, retiredCount: result.retired.length, surveyed: result.surveyed }));
  } finally { await client.$disconnect(); }
})().catch(() => { console.error('Kamal launch authority retirement failed'); process.exitCode = 1; });
