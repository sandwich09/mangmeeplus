import type { PrismaClient } from '../../../generated/prisma/client';
import type { AttachmentStoragePort } from '../../data-model-core/domain/ports/attachment-storage.port';

/** Owner 2026-11-06: an expired demo shop is erased. The link row stays as sales history. */
/** `force` (sales reset/delete, owner 2026-11-09) erases a demo shop before its term ends. */
export async function purgeDemoCompany(db: PrismaClient, storage: AttachmentStoragePort | null, companyId: string, now: Date, force = false): Promise<boolean> {
  // Files first: if the row delete then fails, the next sweep retries and a missing file is fine.
  const files = await db.attachmentObject.findMany({
    where: { companyId, storageProvider: { not: 'db' } },
    select: { bucket: true, objectKey: true, objectVersionId: true },
  });
  for (const file of files) {
    await storage?.deleteObject({ bucket: file.bucket, objectKey: file.objectKey, ...(file.objectVersionId ? { objectVersionId: file.objectVersionId } : {}) });
  }
  return db.$transaction(async tx => {
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { reportClassification: true, planTerm: { select: { termEndsAt: true } } } });
    if (company?.reportClassification !== 'DEMO' || (!force && (!company.planTerm || company.planTerm.termEndsAt > now))) return false;
    const members = await tx.companyMembership.findMany({ where: { companyId }, select: { userId: true } });
    const userIds = members.map(member => member.userId);
    const shared = await tx.companyMembership.findMany({ where: { userId: { in: userIds }, companyId: { not: companyId } }, select: { userId: true } });
    await tx.expenseSubstituteReceiptEvidence.deleteMany({ where: { companyId } });
    await tx.companyOnboardingRun.deleteMany({ where: { companyId } });
    await tx.salesDemoLink.updateMany({ where: { companyId }, data: { companyId: null } });
    await tx.company.delete({ where: { id: companyId } });
    // Demo users are made for this shop only; a user who also works elsewhere is kept.
    await tx.user.deleteMany({ where: { id: { in: userIds.filter(id => !shared.some(row => row.userId === id)) } } });
    return true;
  }, { maxWait: 10_000, timeout: 60_000 });
}
