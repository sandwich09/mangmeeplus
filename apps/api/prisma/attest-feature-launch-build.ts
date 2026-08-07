/** Append only per-build authority for already-materialized SYSTEM/ORDINARY launch rows. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/common/database/prisma.service';
import { assertSpecialistRoutesClosed } from '../src/modules/feature-launch/application/assert-specialist-routes-closed';
import { attestOpenOnThisBuild } from '../src/modules/feature-launch/application/seed-launch-gates';
import { MATERIALIZABLE_LAUNCH_MATRIX_ROWS } from '../src/modules/feature-launch/domain/launch-matrix.catalog';
import { resolveDeploymentIdentity } from '@watchdog-bms/config';

async function main(): Promise<void> {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' }),
  });
  try {
    const service = { client } as unknown as PrismaService;
    const deployment = resolveDeploymentIdentity(process.env);
    const gates = await client.featureLaunchGate.findMany({
      select: { gateKey: true, routeKey: true, state: true },
      orderBy: [{ gateKey: 'asc' }, { routeKey: 'asc' }],
    });
    const expected = MATERIALIZABLE_LAUNCH_MATRIX_ROWS
      .map(({ gateKey, routeKey }) => `${gateKey}\0${routeKey}`).sort();
    const actual = gates.map(({ gateKey, routeKey }) => `${gateKey}\0${routeKey}`).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('launch_gate_catalog_not_materialized_exactly');
    }
    for (const row of MATERIALIZABLE_LAUNCH_MATRIX_ROWS) {
      const gate = gates.find((candidate) => (
        candidate.gateKey === row.gateKey && candidate.routeKey === row.routeKey
      ));
      if (gate?.state === 'OPEN') await attestOpenOnThisBuild(service, row, deployment);
    }
    await assertSpecialistRoutesClosed(service);
    console.log(`launch build attested: source=${deployment.buildReleaseId}`);
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

main().catch(() => {
  console.error('Launch build attestation failed: launch_build_attestation_failed');
  process.exitCode = 1;
});
