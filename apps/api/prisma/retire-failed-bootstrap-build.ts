import { PrismaPg } from '@prisma/adapter-pg';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { PrismaClient } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/common/database/prisma.service';
import {
  LaunchRetirementHalt,
  retireExactFailedBuild,
} from '../src/modules/feature-launch/application/retire-launch-builds';

function flag(name: string): string {
  return process.argv.slice(2).find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
}

async function main() {
  const buildReleaseId = flag('--build');
  const deploymentArn = flag('--deployment-arn');
  const mutationIntentId = flag('--intent-id');
  if (!/^[0-9a-f]{40}$/.test(buildReleaseId)
    || (!['CONFIRMED_NO_MUTATION', 'PRE_INTENT_NO_API_MUTATION'].includes(deploymentArn)
      && !/^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:service-deployment\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(deploymentArn))
    || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(mutationIntentId)) {
    throw new Error('exact bootstrap rollback cleanup requires --build, --deployment-arn and --intent-id');
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
  const prisma = new PrismaClient({ adapter });
  try {
    const result = await retireExactFailedBuild({ client: prisma } as unknown as PrismaService, {
      buildReleaseId,
      deploymentArn: ['CONFIRMED_NO_MUTATION', 'PRE_INTENT_NO_API_MUTATION'].includes(deploymentArn)
        ? null
        : deploymentArn,
      mutationIntentId,
      deployment: resolveDeploymentIdentity(process.env),
      requestId: `bootstrap-rollback-${mutationIntentId}`,
      log: console.log,
    });
    console.log(`bootstrap rollback cleanup complete: retired=${result.retired.length} skipped=${result.skipped.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof LaunchRetirementHalt ? error.message : error);
  process.exit(1);
});
