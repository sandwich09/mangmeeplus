/**
 * Deploy-time v5.1 invariant check (spec:272, spec:239).
 *
 * No SPECIALIST_LEGAL route may be OPEN in v5.1 — a specialist route carries statutory output
 * (50 ทวิ artifacts, filing corrections) that no Thai tax specialist has validated yet. The
 * bootstrap seeds them CLOSED, but seeding CLOSED is not an invariant: an operator command, a
 * restored database or a hand-run SQL can leave one OPEN. So the deploy re-reads the real rows and
 * refuses to ship rather than trusting what it just wrote.
 *
 * Matched by GATE key, not by the exact catalog route: a concrete route materialized under a
 * specialist namespace gate (whose routeKey the catalog cannot enumerate) must be caught too.
 */
import type { PrismaService } from '../../../common/database/prisma.service';
import { FEATURE_LAUNCH_MATRIX } from '../domain/launch-matrix.catalog';

export const SPECIALIST_LEGAL_GATE_KEYS: readonly string[] = [
  ...new Set(FEATURE_LAUNCH_MATRIX.filter((row) => row.routeClass === 'SPECIALIST_LEGAL').map((row) => row.gateKey)),
];

/** Throws with every offending route named. Callers turn that into a non-zero exit. */
export async function assertSpecialistRoutesClosed(prisma: PrismaService): Promise<void> {
  const open = await prisma.client.featureLaunchGate.findMany({
    where: { gateKey: { in: [...SPECIALIST_LEGAL_GATE_KEYS] }, state: 'OPEN' },
    select: { gateKey: true, routeKey: true },
    orderBy: [{ gateKey: 'asc' }, { routeKey: 'asc' }],
  });
  if (open.length === 0) return;
  const routes = open.map((row) => `${row.gateKey}/${row.routeKey}`).join(', ');
  throw new Error(
    `v5.1 invariant violated: SPECIALIST_LEGAL launch routes must be CLOSED, but these are OPEN: ${routes}. `
    + 'Close them (or remove the row) before this deploy proceeds.',
  );
}
