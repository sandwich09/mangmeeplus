import type { ExpenseRecordWithRelations } from '../../domain/models/expense.model';
import { scoreAndFindDuplicates, type DuplicateCandidate } from '../../domain/logic/expense-duplicate.logic';
import type { ExpenseDb, PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';

type InternalAttachmentFingerprint = {
  checksumSha256?: string | null;
  perceptualHash?: string | null;
};

export async function createExpenseDuplicateCandidates(
  repo: PrismaExpenseRepository,
  companyId: string,
  expenseId: string,
  loadedExpense?: ExpenseRecordWithRelations,
  db?: ExpenseDb,
  scopes: { branchIds?: string[] } = {},
): Promise<DuplicateCandidate[]> {
  const expense = loadedExpense ?? await repo.findByIdWithRelations(companyId, expenseId, db, scopes);
  if (!expense) return [];

  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  /**
   * Appendix §5: the derived sources of ONE capture group deliberately cite the same file — one
   * receipt, several issuers — so a sibling is never a duplicate of its own group. A group that
   * reuses ANOTHER group's file, or repeats a document number, still scores as one.
   */
  const captureGroupId = expense.captureGroupId ?? null;
  const isSibling = (candidateGroupId: string | null | undefined) =>
    captureGroupId !== null && candidateGroupId === captureGroupId;
  const candidates = (await repo.findNearDuplicates(companyId, expenseId, since, db, scopes))
    .filter((candidate) => !isSibling(candidate.captureGroupId));
  const primaryAttachment = (
    expense.attachments.find((attachment) => attachment.id === expense.primaryAttachmentId)
      ?? expense.attachments.find((attachment) => attachment.purpose === 'expense.receipt.primary')
  ) as (typeof expense.attachments[number] & InternalAttachmentFingerprint) | undefined;
  const matchesByExpenseId = new Map(scoreAndFindDuplicates(
    {
      checksumSha256: primaryAttachment?.checksumSha256,
      perceptualHash: primaryAttachment?.perceptualHash,
      vendorDocumentNumber: expense.vendorDocumentNumber,
      vendorTaxId: expense.vendorTaxIdSnapshot,
      expenseDate: expense.expenseDate?.toISOString(),
      grandTotalAmount: expense.grandTotalAmount,
      vendorCounterpartyId: expense.vendorCounterpartyId,
      vendorName: expense.vendorNameSnapshot,
    },
    candidates,
  ).map((match) => [match.expenseId, match] as const));

  if (primaryAttachment?.checksumSha256) {
    const exactIds = await repo.findExpenseIdsByAttachmentChecksum(
      companyId,
      expenseId,
      primaryAttachment.checksumSha256,
      db,
      scopes,
      captureGroupId,
    );
    for (const exactId of exactIds) {
      const existing = matchesByExpenseId.get(exactId);
      if (!existing) {
        matchesByExpenseId.set(exactId, { expenseId: exactId, reasonCodes: ['same_checksum'], score: 40 });
      } else if (!existing.reasonCodes.includes('same_checksum')) {
        existing.reasonCodes.unshift('same_checksum');
        existing.score += 40;
      }
    }
  }

  const matches = [...matchesByExpenseId.values()].sort((a, b) => b.score - a.score);
  for (const match of matches) {
    await repo.createDuplicateCandidate(
      companyId,
      expenseId,
      match.expenseId,
      match.reasonCodes,
      match.score,
      db,
    );
  }
  return matches;
}

export async function reconcileExpenseDuplicateCandidates(
  repo: PrismaExpenseRepository,
  companyId: string,
  expenseId: string,
  actorUserId: string,
  scopes: { branchIds?: string[] } = {},
  /** Join the caller's transaction when it already owns one (LINE correction apply). */
  db?: any,
): Promise<{ matches: DuplicateCandidate[]; openCandidates: number; duplicateStatus: 'NO_MATCH' | 'POSSIBLE_DUPLICATE' | 'CONFIRMED_DUPLICATE' | 'OVERRIDDEN' }> {
  let matches: DuplicateCandidate[] = [];
  const state = await repo.runDuplicateCheck(
    { companyId, expenseId, actorUserId, scopes },
    async (tx) => {
      const expense = await repo.findByIdWithRelations(companyId, expenseId, tx, scopes);
      matches = await createExpenseDuplicateCandidates(repo, companyId, expenseId, expense ?? undefined, tx, scopes);
      return matches.map((match) => match.expenseId);
    },
    db,
  );
  return { matches, ...state };
}
