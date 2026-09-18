import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createExpenseDuplicateCandidates } from './expense-duplicate-detection';

/**
 * Appendix §5: the derived sources of ONE capture group cite the same file on purpose — one
 * marketplace receipt, several issuers — so a sibling is never a duplicate of its own group.
 * Everything else still is: another group reusing the file, or a plain expense with the same
 * document number, must keep raising POSSIBLE_DUPLICATE.
 */
const fingerprint = (over: Record<string, unknown> = {}) => ({
  id: 'other', checksumSha256: 'sha-1', perceptualHash: null, vendorDocumentNumber: 'INV-1',
  vendorTaxId: '0105560012345', expenseDate: '2026-09-18T00:00:00.000Z', grandTotalAmount: '100.0000',
  vendorCounterpartyId: null, vendorName: 'ร้านวัสดุ', captureGroupId: null, ...over,
});

function repoWith(options: { candidates: Array<Record<string, unknown>>; checksumIds?: string[] }) {
  const created: string[] = [];
  const checksumCalls: Array<string | null | undefined> = [];
  const repo = {
    findNearDuplicates: async () => options.candidates,
    findExpenseIdsByAttachmentChecksum: async (
      _companyId: string, _excludeId: string, _checksum: string, _db: unknown, _scopes: unknown,
      excludeCaptureGroupId?: string | null,
    ) => {
      checksumCalls.push(excludeCaptureGroupId);
      // The real query excludes in SQL; the fake mirrors it so the argument cannot rot unused.
      return (options.checksumIds ?? []).filter((id) => !(excludeCaptureGroupId && id.startsWith(`${excludeCaptureGroupId}:`)));
    },
    createDuplicateCandidate: async (_companyId: string, _expenseId: string, candidateId: string) => { created.push(candidateId); },
  } as any;
  return { repo, created, checksumCalls };
}

const expense = (over: Record<string, unknown> = {}) => ({
  id: 'e-1', companyId: 'c1', primaryAttachmentId: 'att-1',
  attachments: [{ id: 'att-1', purpose: 'expense.receipt.primary', checksumSha256: 'sha-1', perceptualHash: null }],
  vendorDocumentNumber: 'INV-1', vendorTaxIdSnapshot: '0105560012345', vendorNameSnapshot: 'ร้านวัสดุ',
  expenseDate: new Date('2026-09-18T00:00:00.000Z'), grandTotalAmount: '100.0000', vendorCounterpartyId: null,
  captureGroupId: null, ...over,
}) as any;

describe('duplicate detection and capture siblings', () => {
  it('skips a sibling of the same capture group in the scoring pass', async () => {
    const { repo, created } = repoWith({ candidates: [fingerprint({ id: 'sibling', captureGroupId: 'g-1' })] });
    const matches = await createExpenseDuplicateCandidates(repo, 'c1', 'e-1', expense({ captureGroupId: 'g-1' }));
    assert.deepEqual(matches, []);
    assert.deepEqual(created, []);
  });

  it('still flags an expense of ANOTHER group that reuses the same file', async () => {
    const { repo, created } = repoWith({ candidates: [fingerprint({ id: 'other-group', captureGroupId: 'g-2' })] });
    const matches = await createExpenseDuplicateCandidates(repo, 'c1', 'e-1', expense({ captureGroupId: 'g-1' }));
    assert.deepEqual(matches.map((match) => match.expenseId), ['other-group']);
    assert.deepEqual(created, ['other-group']);
  });

  it('still flags an ordinary expense with the same document number', async () => {
    const { repo, created } = repoWith({ candidates: [fingerprint({ id: 'plain' })] });
    const matches = await createExpenseDuplicateCandidates(repo, 'c1', 'e-1', expense({ captureGroupId: 'g-1' }));
    assert.deepEqual(matches.map((match) => match.expenseId), ['plain']);
    assert.deepEqual(created, ['plain']);
  });

  it('passes the group id to the checksum pass, so an exact-file sibling is excluded there too', async () => {
    const { repo, created, checksumCalls } = repoWith({
      candidates: [],
      checksumIds: ['g-1:sibling', 'g-2:other', 'plain'],
    });
    const matches = await createExpenseDuplicateCandidates(repo, 'c1', 'e-1', expense({ captureGroupId: 'g-1' }));
    assert.deepEqual(checksumCalls, ['g-1']);
    assert.deepEqual(matches.map((match) => match.expenseId).sort(), ['g-2:other', 'plain']);
    assert.deepEqual(created.sort(), ['g-2:other', 'plain']);
  });

  it('leaves an ordinary expense with no group exactly as it was', async () => {
    const { repo, created, checksumCalls } = repoWith({
      candidates: [fingerprint({ id: 'twin', captureGroupId: 'g-1' })],
      checksumIds: ['g-1:sibling'],
    });
    const matches = await createExpenseDuplicateCandidates(repo, 'c1', 'e-1', expense());
    assert.deepEqual(checksumCalls, [null], 'no group means no exclusion');
    assert.deepEqual(matches.map((match) => match.expenseId).sort(), ['g-1:sibling', 'twin']);
    assert.deepEqual(created.sort(), ['g-1:sibling', 'twin']);
  });
});
