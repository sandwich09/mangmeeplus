import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReimbursementGetApprovalBacklogTool, ReimbursementListPendingApprovalsTool } from './erp-reimbursement-tools.use-case';
import { ListApprovalQueueUseCase } from '../../../reimbursements/application/use-cases/reimbursement-approval.use-case';
import { GetReimbursementApprovalBacklogUseCase } from '../../../reimbursements/application/use-cases/reimbursement-summary.use-case';

const baseCtx = {
  companyId: 'co-1',
  userId: 'approver-1',
  membershipId: 'mem-1',
  roles: ['MANAGER'],
  permissions: ['reimbursement.approve'],
  branchIds: ['branch-1'],
  locale: 'th-TH',
} as any;

function queueItem(index: number) {
  return {
    id: `rb-${index}`,
    companyId: 'co-1',
    branchId: index === 0 ? 'branch-1' : undefined,
    requestNo: `RB-2026-${index}`,
    requesterDisplayNameSnapshot: `Requester ${index}`,
    amount: `${100 + index}.00`,
    currency: 'THB',
    submittedAt: '2026-07-12T03:00:00.000Z',
    status: 'PENDING_APPROVAL',
    ageHours: 4,
    slaRisk: false,
  };
}

describe('ReimbursementListPendingApprovalsTool', () => {
  it('returns a bounded redacted summary with source references', async () => {
    const queue = { execute: async () => Array.from({ length: 12 }, (_, i) => queueItem(i)) } as any;

    const result = await new ReimbursementListPendingApprovalsTool(queue).execute(baseCtx);
    const data = result.data as any;

    assert.equal(result.status, 'ok');
    assert.equal(data.total, 12);
    assert.equal(data.items.length, 10);
    assert.deepEqual(data.items[0], {
      id: 'rb-0',
      documentNumber: 'RB-2026-0',
      requesterDisplayName: 'Requester 0',
      amount: '100.00',
      currency: 'THB',
      submittedAt: '2026-07-12T03:00:00.000Z',
      status: 'PENDING_APPROVAL',
      branch: 'branch-1',
    });
    assert.equal(result.sourceRefs[0]?.permissionChecked, true);
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/co-1/reimbursements');
  });

  // The web queue requires `reimbursement.approve`; gating this tool on `reimbursement.read` let a
  // reader list a queue they cannot see on the web.
  it('fails closed for a reader without reimbursement.approve', async () => {
    let called = false;
    const queue = { execute: async () => { called = true; return []; } } as any;

    const result = await new ReimbursementListPendingApprovalsTool(queue)
      .execute({ ...baseCtx, permissions: ['reimbursement.read'] });

    assert.equal(result.status, 'forbidden');
    assert.equal(called, false);
    // Item 3 (T-143): a bare 'forbidden' gave the gateway nothing to render, so a STAFF user asking
    // for the approval queue could end up shown their own claims summary instead with no statement
    // that they cannot see the queue. A typed errorCode survives enforceSourceHonesty (the gateway's
    // non-'ok' passthrough keeps only toolName/status/sourceRefs/asOf/errorCode/errorMessage) so it
    // can render an honest denial instead of any answer shaped like the approval queue.
    assert.equal(result.errorCode, 'REIMBURSEMENT_APPROVAL_NOT_PERMITTED');
    assert.deepEqual(result.sourceRefs, []);
    assert.equal(result.data, undefined);
  });

  // Approver eligibility and branch scope live in the use case, so the tool must hand it the
  // caller's own roles and scopes rather than re-querying the repository with a bare companyId.
  it('delegates to the approval queue with the caller roles and branch scope', async () => {
    let captured: any;
    const queue = { execute: async (ctx: any) => { captured = ctx; return []; } } as any;

    await new ReimbursementListPendingApprovalsTool(queue).execute(baseCtx, { companyId: 'other-company' } as any);

    assert.equal(captured.companyId, 'co-1');
    assert.equal(captured.userId, 'approver-1');
    assert.deepEqual(captured.roles, ['MANAGER']);
    assert.deepEqual(captured.permissions, ['reimbursement.approve']);
    assert.deepEqual(captured.scopes, { branchIds: ['branch-1'], locationIds: undefined });
  });

  // Payout spec §11.2: an AI answer never carries a payout account, not even the masked one.
  it('keeps the payout account out of the answer even when the queue row carries it', async () => {
    const leaky = {
      ...queueItem(0), payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: 'fingerprint',
      payout: { payoutMethod: 'BANK_TRANSFER', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', accountNumber: '0123456789' },
    };
    const result = await new ReimbursementListPendingApprovalsTool({ execute: async () => [leaky] } as any).execute(baseCtx);

    assert.deepEqual(Object.keys((result.data as any).items[0]).sort(),
      ['amount', 'branch', 'currency', 'documentNumber', 'id', 'requesterDisplayName', 'status', 'submittedAt']);
    assert.doesNotMatch(JSON.stringify(result), /payout|account|6789|กสิกร|สมชาย/i);
    // The backlog and the AI summary shape their own rows too; none of the three reads payout data at all.
    // The one thing the backlog asks is whether a claim was sent back from the pay step, whom it waits for
    // and under which label (the correction phase and its desk, spec §17.3): two questions of the claim's
    // own logic, which answers with the claim page's status label. Where a claim stands, never what its
    // account is.
    for (const file of ['erp-reimbursement-tools.use-case.ts', '../../../reimbursements/application/use-cases/reimbursement-summary.use-case.ts']) {
      assert.doesNotMatch(readFileSync(join(__dirname, file), 'utf8'), /payout(?!_?correction)|accountNumber|accountLast4/i, file);
    }
  });

  it('returns an empty summary when no approvals are pending', async () => {
    const queue = { execute: async () => [] } as any;

    const result = await new ReimbursementListPendingApprovalsTool(queue).execute(baseCtx);

    assert.deepEqual(result.data, { total: 0, items: [] });
    assert.equal(result.sourceRefs.length, 1);
  });
});

describe('ReimbursementGetApprovalBacklogTool', () => {
  const backlog = {
    accessScope: 'company', total: 12, totalsByCurrency: [{ currency: 'THB', amount: '1200.00' }],
    byApprover: [{ name: 'สมศรี', count: 2, totalsByCurrency: [], oldestSubmittedOn: '2026-09-23', longestWaitDays: 7 }],
    sharedPile: { label: 'กองกลาง (อนุมัติได้หลายคน)', count: 3, totalsByCurrency: [], oldestSubmittedOn: '2026-09-24', longestWaitDays: 6 },
    desks: [], items: Array.from({ length: 10 }, (_, i) => ({ id: `rb-${i}` })),
  };

  // Scope, branch and active-approver rules live in the use case: the adapter hands it the caller's
  // own roles/scopes and only "requester: me" from the model, never anything else it sent.
  it('delegates with the caller context and passes only requester "me" through', async () => {
    const seen: any[] = [];
    const tool = new ReimbursementGetApprovalBacklogTool({ execute: async (ctx: any, input: any) => { seen.push({ ctx, input }); return backlog; } } as any);

    await tool.execute(baseCtx, { requester: 'me' });
    await tool.execute(baseCtx, { requester: 'someone-else', companyId: 'other' } as any);

    assert.deepEqual(seen.map((call) => call.input), [{ requester: 'me' }, {}]);
    assert.equal(seen[0].ctx.companyId, 'co-1');
    assert.deepEqual(seen[0].ctx.roles, ['MANAGER']);
    assert.deepEqual(seen[0].ctx.scopes, { branchIds: ['branch-1'], locationIds: undefined });
  });

  it('links the claim list, states its own scope, and reports the item cap as more rows', async () => {
    const result = await new ReimbursementGetApprovalBacklogTool({ execute: async () => backlog } as any).execute(baseCtx, { requester: 'me' });

    assert.equal(result.status, 'ok');
    assert.equal(result.data, backlog);
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/co-1/reimbursements');
    assert.equal(result.queryApplied?.accessScope, 'company');
    assert.deepEqual(result.queryApplied?.filters, { requester: 'me' });
    assert.deepEqual(result.completeness?.rows, { returned: 10, hasMore: true, nextCursor: null });
    assert.equal(result.completeness?.groups.returned, 2);
  });

  it('answers forbidden instead of throwing when the caller cannot read claims', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    const result = await new ReimbursementGetApprovalBacklogTool({ execute: async () => { throw new ForbiddenException('no'); } } as any)
      .execute(baseCtx);
    assert.equal(result.status, 'forbidden');
    assert.equal(result.data, undefined);
  });
});

// Payout spec §14.7, §17.3. A claim sent back to have its payout account corrected is PENDING_APPROVAL,
// with no step open while its requester gives the account. The two tools below are what the assistant
// reads about such a claim, here over the real use cases: it waits for its requester, in the words of
// the claim page, and for its approver again only once the account is given.
describe('a claim whose payout account is being corrected, as the assistant reads it', () => {
  // 10:00 on 1 October 2026 in Bangkok: sent on 20 September, sent back yesterday, answered this morning.
  const NOW = new Date('2026-10-01T03:00:00.000Z');
  const claim = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, companyId: 'co-1', branchId: 'branch-1', requestNo: `RB-202609-${id}`, requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'สมชาย',
    reason: 'ค่าเดินทาง', categoryKey: 'travel', amount: '580.5000', outstandingAmount: '580.5000', paymentTotalAmount: '0.0000', currency: 'THB',
    incurredDate: NOW, status: 'PENDING_APPROVAL', financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'NOT_PAYABLE', duplicateStatus: 'NO_MATCH',
    receiptRequirementStatus: 'ATTACHED', postingStatus: 'posted', submittedAt: new Date('2026-09-20T03:00:00.000Z'),
    createdAt: new Date('2026-09-20T02:00:00.000Z'), updatedAt: NOW,
    payoutCorrectionRequestedAt: new Date('2026-09-30T03:00:00.000Z'), payoutCorrectionRequestedByUserId: 'payer-1', payoutCorrectionReasonCode: 'ACCOUNT_NUMBER_WRONG',
    payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: 'f'.repeat(64),
    approvalSteps: [] as any[], ...overrides,
  });
  const waitingStep = { id: 'step-2', companyId: 'co-1', reimbursementRequestId: '000002', sequenceNo: 1, status: 'PENDING', assignedApproverUserIds: ['approver-1'], approverRoleSnapshot: 'MANAGER' };
  const withRequester = claim('000001');
  const withApprover = claim('000002', { payoutCorrectionSubmittedAt: new Date('2026-10-01T02:00:00.000Z'), payoutDestinationVersion: 2, currentApprovalStepId: 'step-2', approvalSteps: [waitingStep] });
  const repo = {
    findPolicy: async () => null,
    listRequests: async () => [withRequester, withApprover],
    findPendingApprovalSteps: async () => [waitingStep],
    findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
    getUserDisplayNames: async () => ({ 'approver-1': 'สมศรี' }),
  } as any;
  const approver = { ...baseCtx, permissions: ['reimbursement.approve', 'reimbursement.reject', 'reimbursement.read'] };

  it('says it waits for its requester to correct the payout account, counts it for no approver, and lists it for approval once the account is given', async () => {
    // The approver's own queue: nothing to decide while the claim is with its requester, the claim again once the account is given.
    const queue = await new ReimbursementListPendingApprovalsTool(new ListApprovalQueueUseCase(repo)).execute(approver);
    assert.deepEqual(queue.data, {
      total: 1,
      items: [{
        id: '000002', documentNumber: 'RB-202609-000002', requesterDisplayName: 'สมชาย', amount: '580.5000', currency: 'THB',
        submittedAt: '2026-09-20T03:00:00.000Z', status: 'PENDING_APPROVAL', branch: 'branch-1',
      }],
    });
    assert.doesNotMatch(JSON.stringify(queue), /payout|account|ffff/i);

    const backlog = new GetReimbursementApprovalBacklogUseCase(repo, { log: async () => undefined } as any);
    const tool = new ReimbursementGetApprovalBacklogTool({ execute: (ctx: any, input: any) => backlog.execute(ctx, input, NOW) } as any);
    const result = await tool.execute(approver);
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, {
      accessScope: 'company',
      total: 2,
      awaitingApprovalCount: 1,
      totalsByCurrency: [{ currency: 'THB', amount: '1161.00' }],
      byApprover: [{ name: 'สมศรี', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '580.50' }], oldestSubmittedOn: '2026-10-01', longestWaitDays: 0 }],
      sharedPile: null,
      desks: [{
        kind: 'requester_correction', label: 'รอผู้เบิกแก้บัญชีรับเงิน', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '580.50' }],
        oldestSentBackOn: '2026-09-30', longestWaitDays: 1,
        note: 'ใบเบิกถูกส่งกลับให้ผู้เบิกแก้บัญชีรับเงินคืน ผู้เบิกแก้ได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้',
      }],
      items: [
        { id: '000001', documentNumber: 'RB-202609-000001', requesterName: 'สมชาย', amount: '580.50', currency: 'THB',
          waitingOn: 'รอผู้เบิกแก้บัญชีรับเงิน', submittedOn: '2026-09-20', sentBackOn: '2026-09-30', waitDays: 1 },
        { id: '000002', documentNumber: 'RB-202609-000002', requesterName: 'สมชาย', amount: '580.50', currency: 'THB',
          waitingOn: 'สมศรี', submittedOn: '2026-09-20', resubmittedOn: '2026-10-01', waitDays: 0 },
      ],
    });
    // Where the claim stands and nothing of the account, the reason code or who sent it back.
    assert.doesNotMatch(JSON.stringify(result.data), /payout|account|ffff/i);
    assert.doesNotMatch(JSON.stringify(result.data), /ACCOUNT_NUMBER_WRONG|payer-1|AWAITING_/);
  });

  const backlogOf = async (claims: unknown[]) => {
    const backlog = new GetReimbursementApprovalBacklogUseCase({ ...repo, listRequests: async () => claims }, { log: async () => undefined } as any);
    return new ReimbursementGetApprovalBacklogTool({ execute: (ctx: any, input: any) => backlog.execute(ctx, input, NOW) } as any).execute(approver);
  };

  // The proof that a claim that held an account reads as it did: what `reimbursement.get_approval_backlog` returned for
  // these two claims at 603f461dd (develop before the words of a round followed the case), captured from that build
  // and kept here byte for byte. A pinned evaluation of the assistant (R-23, a claim sent back with a wrong account
  // number and still with its requester) reads the label, the item and the note of exactly this row.
  it('returns for a claim that held an account and waits for its requester exactly the bytes it returned before', async () => {
    assert.equal(JSON.stringify((await backlogOf([withRequester, withApprover])).data),
      '{"accessScope":"company","total":2,"awaitingApprovalCount":1,"totalsByCurrency":[{"currency":"THB","amount":"1161.00"}],"byApprover":[{"name":"สมศรี","count":1,"totalsByCurrency":[{"currency":"THB","amount":"580.50"}],"oldestSubmittedOn":"2026-10-01","longestWaitDays":0}],"sharedPile":null,"desks":[{"kind":"requester_correction","label":"รอผู้เบิกแก้บัญชีรับเงิน","count":1,"totalsByCurrency":[{"currency":"THB","amount":"580.50"}],"oldestSentBackOn":"2026-09-30","longestWaitDays":1,"note":"ใบเบิกถูกส่งกลับให้ผู้เบิกแก้บัญชีรับเงินคืน ผู้เบิกแก้ได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้"}],"items":[{"id":"000001","documentNumber":"RB-202609-000001","requesterName":"สมชาย","amount":"580.50","currency":"THB","waitingOn":"รอผู้เบิกแก้บัญชีรับเงิน","submittedOn":"2026-09-20","sentBackOn":"2026-09-30","waitDays":1},{"id":"000002","documentNumber":"RB-202609-000002","requesterName":"สมชาย","amount":"580.50","currency":"THB","waitingOn":"สมศรี","submittedOn":"2026-09-20","resubmittedOn":"2026-10-01","waitDays":0}]}');
  });

  // Payout spec §17.3: no field is added or removed. The one row of claims that wait for their requester becomes one row
  // per label, each whole in itself, and each claim waits on the label of its own row. Before, a claim with no account
  // and a claim that had asked for cash were both said to wait for "แก้บัญชีรับเงิน".
  it('gives a claim with no account, and a claim that asked for cash, a row and words of their own, and leaves the row of an account as it was', async () => {
    const sentBackOn = (day: string) => new Date(`2026-09-${day}T03:00:00.000Z`);
    const noAccount = claim('000003', { payoutMethod: undefined, payoutDestinationVersion: undefined, payoutFingerprint: undefined, payoutCorrectionReasonCode: 'NO_ACCOUNT_ON_CLAIM', payoutCorrectionRequestedAt: sentBackOn('28') });
    const askedForCash = claim('000004', { payoutMethod: 'CASH', payoutDestinationVersion: undefined, payoutFingerprint: 'cash', payoutCorrectionReasonCode: 'CASH_NOT_PAYABLE', payoutCorrectionRequestedAt: sentBackOn('29') });
    const alone = (await backlogOf([withRequester, withApprover])).data as any;
    const result = await backlogOf([askedForCash, withApprover, noAccount, withRequester]);
    const data = result.data as any;

    const row = (label: string, oldestSentBackOn: string, longestWaitDays: number, note: string) => ({
      kind: 'requester_correction', label, count: 1, totalsByCurrency: [{ currency: 'THB', amount: '580.50' }], oldestSentBackOn, longestWaitDays, note,
    });
    assert.deepEqual(data.desks, [
      row('รอผู้เบิกแก้บัญชีรับเงิน', '2026-09-30', 1, 'ใบเบิกถูกส่งกลับให้ผู้เบิกแก้บัญชีรับเงินคืน ผู้เบิกแก้ได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้'),
      row('รอผู้เบิกเพิ่มบัญชีรับเงิน', '2026-09-28', 3, 'ใบเบิกถูกส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน ผู้เบิกเพิ่มได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้'),
      row('รอผู้เบิกเลือกวิธีรับเงินคืน', '2026-09-29', 2, 'ใบเบิกถูกส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ผู้เบิกเลือกได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้'),
    ]);
    assert.deepEqual(data.items.map((item: any) => [item.id, item.waitingOn, item.sentBackOn ?? item.resubmittedOn, item.waitDays]), [
      ['000003', 'รอผู้เบิกเพิ่มบัญชีรับเงิน', '2026-09-28', 3], ['000004', 'รอผู้เบิกเลือกวิธีรับเงินคืน', '2026-09-29', 2],
      ['000001', 'รอผู้เบิกแก้บัญชีรับเงิน', '2026-09-30', 1], ['000002', 'สมศรี', '2026-10-01', 0],
    ]);
    // The row and the item of the claim that held an account are, byte for byte, what they are when it is listed alone.
    assert.equal(JSON.stringify(data.desks[0]), JSON.stringify(alone.desks[0]));
    assert.equal(JSON.stringify(data.items[2]), JSON.stringify(alone.items[0]));
    // The same fields as before, in every row and item: none added, none removed.
    for (const desk of data.desks) assert.deepEqual(Object.keys(desk), Object.keys(alone.desks[0]));
    for (const item of data.items.slice(0, 3)) assert.deepEqual(Object.keys(item), Object.keys(alone.items[0]));
    // Three claims are with their requester and one waits for approval, as the counts say; each row is one more group.
    assert.deepEqual([data.total, data.awaitingApprovalCount, data.byApprover.map((group: any) => group.count), result.completeness?.groups.returned], [4, 1, [1], 4]);
    // Where each claim stands and nothing of an account, a method, a reason code or who sent it back.
    assert.doesNotMatch(JSON.stringify(result.data), /payout|account|ffff|cash|NO_ACCOUNT|payer-1|AWAITING_/i);
  });
});
