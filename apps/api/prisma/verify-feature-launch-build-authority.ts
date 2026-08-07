/** Read-only proof that an incident API build is already accepted and not retired. */
import { resolveDeploymentIdentity } from '@watchdog-bms/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { isOpenOnDeployment } from '../src/modules/feature-launch/application/launch-gate.guard';
import { MATERIALIZABLE_LAUNCH_MATRIX_ROWS } from '../src/modules/feature-launch/domain/launch-matrix.catalog';
import { assertNoProductionA5AwsCredentials } from '../src/scripts/production-a5-evidence.pg';

type LaunchGateRow = { gateKey: string; routeKey: string; state: 'OPEN' | 'CLOSED'; generation: number };

export function assertIncidentLaunchGateCatalog(gates: readonly LaunchGateRow[]): void {
  const expected = MATERIALIZABLE_LAUNCH_MATRIX_ROWS
    .map(({ gateKey, routeKey }) => `${gateKey}\0${routeKey}`).sort();
  const actual = gates.map(({ gateKey, routeKey }) => `${gateKey}\0${routeKey}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('incident_launch_gate_catalog_not_exact');
  }
  const routeClassByKey = new Map(MATERIALIZABLE_LAUNCH_MATRIX_ROWS.map((row) => [
    `${row.gateKey}\0${row.routeKey}`, row.routeClass,
  ]));
  if (gates.some((gate) => gate.state === 'OPEN'
    && routeClassByKey.get(`${gate.gateKey}\0${gate.routeKey}`) === 'SPECIALIST_LEGAL')) {
    throw new Error('incident_specialist_launch_route_open');
  }
}

async function main(): Promise<void> {
  assertNoProductionA5AwsCredentials(process.env);
  const deployment = resolveDeploymentIdentity(process.env);
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' }),
  });
  try {
    await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2000ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '300000ms'");
      const gates = await tx.featureLaunchGate.findMany({
        select: { gateKey: true, routeKey: true, state: true, generation: true },
        orderBy: [{ gateKey: 'asc' }, { routeKey: 'asc' }],
      });
      assertIncidentLaunchGateCatalog(gates);
      for (const gate of gates) {
        if (gate.state === 'OPEN' && !await isOpenOnDeployment(
          tx, gate.gateKey, gate.routeKey, gate.generation, deployment,
        )) throw new Error('incident_build_not_accepted_on_every_open_route');
      }
    }, { maxWait: 10_000, timeout: 320_000 });
    console.log(`incident build authority verified read-only: ${deployment.buildReleaseId}`);
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Incident build authority failed: incident_build_authority_failed');
    process.exitCode = 1;
  });
}
