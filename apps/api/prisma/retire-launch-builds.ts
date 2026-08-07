/**
 * POST-DEPLOY launch-build retirement CLI (UAT r5 item 1).
 *
 *   tsx prisma/retire-launch-builds.ts [--mode=retire|reconcile] --active-builds=<sha>[,<sha>] --deployment-arn=<arn>
 *
 * Runs AFTER the rollout is healthy and verified, never before: the pre-deploy release task only
 * appends acceptance of the incoming build (`sync-feature-launch-gates.ts`), and this pass is what
 * takes authority away from every attested build that is no longer serving.
 *
 * `--mode=reconcile` (UAT r6 item 4b) is the same pass after a rollout that FAILED or rolled back:
 * the pre-attested incoming build never served, so it is retired and the build the platform rolled
 * back to keeps its authority. Same halts, different recorded reason.
 *
 * `--active-builds` is REQUIRED and explicit — the caller reads it from the deployment platform, and
 * nothing here infers the window from transition recency. Exits non-zero, having retired nothing, if
 * the list is empty, wider than the window, or names a build the release task never attested.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { PrismaClient } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/common/database/prisma.service';
import {
  LaunchRetirementHalt,
  type RetireLaunchBuildsMode,
  retireLaunchBuilds,
} from '../src/modules/feature-launch/application/retire-launch-builds';

const FLAG = '--active-builds=';
const MODE_FLAG = '--mode=';
const DEPLOYMENT_FLAG = '--deployment-arn=';
const USAGE = `Usage: tsx prisma/retire-launch-builds.ts [${MODE_FLAG}retire|reconcile] ${FLAG}<sha>[,<sha>] ${DEPLOYMENT_FLAG}<arn>`;

function parseActiveBuilds(argv: readonly string[]): string[] {
  const arg = argv.find((value) => value.startsWith(FLAG));
  if (!arg) {
    console.error(USAGE);
    process.exit(2);
  }
  return arg.slice(FLAG.length).split(',').map((build) => build.trim()).filter((build) => build !== '');
}

function parseMode(argv: readonly string[]): RetireLaunchBuildsMode {
  const arg = argv.find((value) => value.startsWith(MODE_FLAG));
  const mode = arg ? arg.slice(MODE_FLAG.length).trim() : 'retire';
  if (mode !== 'retire' && mode !== 'reconcile') {
    console.error(`Unknown mode '${mode}'.\n${USAGE}`);
    process.exit(2);
  }
  return mode;
}

function parseDeploymentArn(argv: readonly string[]): string {
  const value = argv.find((arg) => arg.startsWith(DEPLOYMENT_FLAG))?.slice(DEPLOYMENT_FLAG.length) ?? '';
  if (!/^arn:aws:ecs:[a-z0-9-]+:[0-9]{12}:service-deployment\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(value)) {
    console.error(USAGE);
    process.exit(2);
  }
  return value;
}

async function main() {
  const activeBuilds = parseActiveBuilds(process.argv.slice(2));
  const mode = parseMode(process.argv.slice(2));
  const deploymentArn = parseDeploymentArn(process.argv.slice(2));
  const deployment = resolveDeploymentIdentity(process.env);
  const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
  const prisma = new PrismaClient({ adapter });
  try {
    // The pass needs only `.client`; PrismaService itself is a Nest provider and is not
    // constructible outside the app context.
    const service = { client: prisma } as unknown as PrismaService;
    const result = await retireLaunchBuilds(service, {
      activeBuilds,
      mode,
      deploymentArn,
      deployment,
      requestId: `retire-launch-builds-${mode}-${deployment.targetEnvironment}-${Date.now()}`,
      log: (message) => console.log(message),
    });
    for (const row of result.retired) {
      console.log(`  retired ${row.gateKey}/${row.routeKey} g${row.generation} build=${row.buildReleaseId} seq=${row.seq}`);
    }
    for (const row of result.skipped) {
      console.log(`  skipped ${row.gateKey}/${row.routeKey}: ${row.reason}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // A halt is an expected refusal with an actionable message, not a stack trace to decode.
  if (err instanceof LaunchRetirementHalt) console.error(err.message);
  else console.error('Launch build retirement failed:', err);
  process.exit(1);
});
