import { Prisma } from '../../../generated/prisma/client';

/** Both halves must use this exact key so CLOSE and a final root mutation are linearized. */
export const sharedLaunchGateLock = (gateKey: string, routeKey: string) =>
  Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtext(${`launch_gate:${gateKey}:${routeKey}`}))`;

export const exclusiveLaunchGateLock = (gateKey: string, routeKey: string) =>
  Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`launch_gate:${gateKey}:${routeKey}`}))`;
