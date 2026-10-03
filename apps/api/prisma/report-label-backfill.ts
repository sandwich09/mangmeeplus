/**
 * One-time release data job (executive backend spec §12.2, Q16): the report classification of the
 * companies that existed before `20261003090000_company_report_labels`. New companies are labelled
 * when they are created (signup provisioning writes CUSTOMER); this catches up the old ones.
 *
 *  - A company the normal signup created becomes CUSTOMER. The proof is a signup request that names
 *    it: `CompanySignupRequest.companyId` is written only for the company onboarding creates from that
 *    request (inside the company's own transaction, and again by `completeProvisioning` with the same
 *    id), so an admin-created, seeded or platform company never has one.
 *  - The platform company becomes INTERNAL (it is read as INTERNAL whatever its row says; this only
 *    makes the row agree).
 *  - Every other company stays unclassified for the System Admin to label.
 *
 * Runs once. Every release calls it (from `sync-permissions.ts`); the first run writes a marker audit
 * row and every later run finds it and changes nothing, so a label the admin clears afterwards is not
 * put back. Each labelled company gets the same audit row the partner profile update writes, with the
 * system as actor. Two runs at once (two booting containers) are serialised by an advisory lock.
 */
import type { PrismaClient } from '../src/generated/prisma/client';

export const REPORT_LABEL_BACKFILL_REQUEST_ID = 'report-label-backfill:v1';
/** `PLATFORM_TENANT_ID` (sales-context), restated so this release script loads no application module. */
const PLATFORM_COMPANY_ID = 'seed-watchdog-system-company';
const ACTOR = 'report-label-backfill';

export async function backfillReportLabels(prisma: Pick<PrismaClient, '$transaction'>, log: (message: string) => void = console.log) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ACTOR}, 0))`;
    const marker = await tx.auditLog.findFirst({ where: { requestId: REPORT_LABEL_BACKFILL_REQUEST_ID, targetId: null }, select: { id: true } });
    if (marker) return null;

    const [platform] = await tx.$queryRaw<Array<{ before: string | null }>>`
      SELECT "reportClassification" AS before FROM "Company" WHERE id = ${PLATFORM_COMPANY_ID} FOR UPDATE`;
    const internal = platform && platform.before !== 'INTERNAL' ? await tx.$executeRaw`
      UPDATE "Company" SET "reportClassification" = 'INTERNAL', "reportClassifiedAt" = now(), "reportClassifiedByUserId" = NULL
      WHERE id = ${PLATFORM_COMPANY_ID}` : 0;
    const customers = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "Company" c SET "reportClassification" = 'CUSTOMER', "reportClassifiedAt" = now(), "reportClassifiedByUserId" = NULL
      WHERE c."reportClassification" IS NULL AND c.id <> ${PLATFORM_COMPANY_ID}
        AND EXISTS (SELECT 1 FROM "CompanySignupRequest" s WHERE s."companyId" = c.id)
      RETURNING c.id`;

    const audit = (targetId: string | null, metadataJson: Record<string, unknown>) => ({
      actorType: 'SYSTEM' as const, actorRefId: ACTOR, action: 'system.partner_company.update', targetType: 'company', targetId,
      requestId: REPORT_LABEL_BACKFILL_REQUEST_ID, result: 'SUCCESS' as const, riskLevel: 'MEDIUM' as const, metadataJson: { source: ACTOR, ...metadataJson },
    });
    await tx.auditLog.createMany({ data: [
      ...(internal ? [audit(PLATFORM_COMPANY_ID, { changedFields: ['reportClassification'], reportClassification: { from: platform!.before, to: 'INTERNAL' } })] : []),
      ...customers.map(({ id }) => audit(id, { changedFields: ['reportClassification'], reportClassification: { from: null, to: 'CUSTOMER' } })),
      // The marker (no target): present means the job has run, whatever it found.
      audit(null, { labelledCustomer: customers.length, labelledInternal: internal }),
    ] });
    return { customer: customers.length, internal };
  });
  log(result
    ? `Report-label backfill: ${result.customer} signup companies labelled CUSTOMER, ${result.internal} platform company labelled INTERNAL.`
    : 'Report-label backfill: already done (marker found), nothing changed.');
  return result;
}
