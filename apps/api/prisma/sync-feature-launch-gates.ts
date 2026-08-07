/**
 * Idempotent FEATURE_LAUNCH_MATRIX bootstrap for any environment (safe on production).
 * Runs on production boot / in the release task after `migrate deploy`, next to the other syncs,
 * so a route the code already guards has a durable gate row before the first request.
 *
 * Second run is a no-op, and a route an operator has already closed is never reopened —
 * see `src/modules/feature-launch/application/seed-launch-gates.ts`.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/common/database/prisma.service';
import { seedLaunchGates } from '../src/modules/feature-launch/application/seed-launch-gates';
import { assertSpecialistRoutesClosed } from '../src/modules/feature-launch/application/assert-specialist-routes-closed';

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' });
  const prisma = new PrismaClient({ adapter });
  try {
    // The seeder needs only `.client`; PrismaService itself is a Nest provider and is not
    // constructible outside the app context.
    const service = { client: prisma } as unknown as PrismaService;
    const result = await seedLaunchGates(service, {
      log: (message) => console.log(message),
    });
    for (const skipped of result.skipped) {
      console.log(`  skipped ${skipped.gateKey}/${skipped.routeKey}: ${skipped.reason}`);
    }
    // Opt-in so local dev seeding is unaffected; the deploy paths pass it and abort on a violation.
    if (process.argv.includes('--verify-specialist-closed')) {
      await assertSpecialistRoutesClosed(service);
      console.log('launch gates: SPECIALIST_LEGAL routes verified CLOSED');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Launch gate sync failed:', err);
  process.exit(1);
});
