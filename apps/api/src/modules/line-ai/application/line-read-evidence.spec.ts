import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_AI_EXPENSE_CRITERION_REPLIES } from '@watchdog-bms/contracts';
import { isExpenseCriterionOnlyText, LineReadEvidenceService, parseExpenseCriterionAccessAuthorization, thaiMonthMentions } from './line-read-evidence.service';
import { lineDeliveryRecipientHash, resolvedLineDeliveryAccessFingerprint } from './line-delivery-access';

describe('read-free LINE outcome authorization', () => {
  const authorization = {
    v: 1,
    producerId: 'producer-1',
    access: {
      kind: 'expense_criterion_confirmation', userId: 'user-1', companyId: 'company-1', membershipId: 'membership-1',
      fingerprint: '{}', webhookEventId: 'event-1', recipientHash: 'a'.repeat(64), channelId: 'channel-1', chatKeyHash: 'b'.repeat(16),
    },
  };

  it('accepts only the explicit read-free criterion proof', () => {
    assert.equal(parseExpenseCriterionAccessAuthorization(authorization)?.userId, 'user-1');
    assert.equal(parseExpenseCriterionAccessAuthorization({ ...authorization, read: { ids: [] } }), null);
    assert.equal(parseExpenseCriterionAccessAuthorization({ ...authorization, access: { ...authorization.access, kind: 'generic' } }), null);
  });

  it('limits the fixed answer to exclusion-only follow-ups', () => {
    assert.equal(isExpenseCriterionOnlyText('ยอดค่าใช้จ่ายไม่รวมรายการยกเลิกใช่ไหม'), true);
    assert.equal(isExpenseCriterionOnlyText('ยอดค่าใช้จ่ายไม่รวมรายการยกเลิกกับปฏิเสธไหม'), true);
    assert.equal(isExpenseCriterionOnlyText('เอาแบบไม่รวมยอดยกเลิกและปฏิเสธ', true), true);
    assert.equal(isExpenseCriterionOnlyText('อันนี้ไม่รวมรายการยกเลิกใช่ไหม', true), true);
    assert.equal(isExpenseCriterionOnlyText('เอาแบบไม่รวมยอดยกเลิกและปฏิเสธ'), false);
    assert.equal(isExpenseCriterionOnlyText('ยอดขายไม่รวมยกเลิกใช่ไหม'), false);
    assert.equal(isExpenseCriterionOnlyText('ยอดค่าใช้จ่ายและยอดขายไม่รวมยกเลิกใช่ไหม', true), false);
    assert.equal(isExpenseCriterionOnlyText('เดือนที่แล้วไม่รวมรายการยกเลิกใช่ไหม'), false);
    assert.equal(isExpenseCriterionOnlyText('เอาเฉพาะสาขา A แบบไม่รวมยกเลิก'), false);
    assert.equal(isExpenseCriterionOnlyText('ขอรายการยกเลิกที่ไม่รวมในยอด'), false);
    assert.equal(isExpenseCriterionOnlyText('ยอดไม่รวมยกเลิกมีรายการอะไรบ้าง'), false);
  });

  it('finds concatenated and one-character misspelled Thai months', () => {
    assert.deepEqual(thaiMonthMentions('กรกฏาคมและสิงหาคม 2569'), [7, 8]);
    assert.deepEqual(thaiMonthMentions('สรุปค่าใช้จ่ายเดือนสิงหาคม 2569'), [8]);
  });

  it('rejects a read-free authorization when a separate presentation could change delivered content', async () => {
    const service = new LineReadEvidenceService({ client: {
      lineReadEvidence: { count: async () => 0 }, companyFeatureEntitlement: { findMany: async () => [] },
    } } as any, { resolveAccess: async () => ({ companyId: 'company-1', permissions: ['ai.tool.invoke', 'expense.read'] }) } as any, new Map());
    const request = { messageText: 'ไม่รวมรายการที่ถูกปฏิเสธหรือยกเลิกแล้วใช่ไหม',
      userContext: { companyId: 'company-1', internalUserId: 'user-1' }, valueCandidates: { periods: [] },
      conversationContext: { deliveredExpenseSummary: { statusBasis: 'exclude_rejected_voided', ranges: [{ fromDate: '2026-08-01', toDate: '2026-08-31', branchId: null }] } } } as any;
    const response = { deterministicExpenseCriterionConfirmation: true, refused: false, toolsInvoked: [], toolCalls: [],
      sourceRefs: [], sourceLabels: [], webLinks: [], replyText: LINE_AI_EXPENSE_CRITERION_REPLIES.generalTh } as any;
    assert.equal(await service.isReadFreeExpenseCriterionConfirmation(request, response), true);
    assert.equal(await service.isReadFreeExpenseCriterionConfirmation({ ...request,
      messageText: 'ยอดขายและค่าใช้จ่ายไม่รวมยกเลิกใช่ไหม' }, response), false);
    assert.equal(await service.isReadFreeExpenseCriterionConfirmation({ ...request,
      messageText: 'ยอดขายไม่รวมยกเลิกใช่ไหม' }, response), false);
    assert.equal(await service.isReadFreeExpenseCriterionConfirmation(request, { ...response,
      presentation: { kind: 'answer_cards', cards: [{ text: 'ยอด 1,000 บาท' }] } }), false);
    assert.equal(await service.isReadFreeExpenseCriterionConfirmation(request, { ...response, sourceLabels: ['ERP'] }), false);
  });

  it('requires current expense permission and entitlement before issuing read-free proof', async () => {
    const prisma = { client: { lineReadEvidence: { count: async () => 0 }, companyFeatureEntitlement: { findMany: async () => [] } } } as any;
    const request = { messageText: 'ยอดค่าใช้จ่ายไม่รวมรายการยกเลิกและปฏิเสธใช่ไหม',
      userContext: { companyId: 'company-1', internalUserId: 'user-1' }, valueCandidates: { periods: [] } } as any;
    const response = { deterministicExpenseCriterionConfirmation: true, refused: false, toolsInvoked: [], toolCalls: [],
      sourceRefs: [], sourceLabels: [], webLinks: [], replyText: LINE_AI_EXPENSE_CRITERION_REPLIES.generalTh } as any;
    const noExpensePermission = new LineReadEvidenceService(prisma,
      { resolveAccess: async () => ({ companyId: 'company-1', permissions: ['ai.tool.invoke'] }) } as any, new Map());
    const allowed = new LineReadEvidenceService(prisma,
      { resolveAccess: async () => ({ companyId: 'company-1', permissions: ['ai.tool.invoke', 'expense.read'] }) } as any, new Map());
    const featureDisabled = new LineReadEvidenceService({ client: {
      lineReadEvidence: { count: async () => 0 },
      companyFeatureEntitlement: { findMany: async () => [{ featureKey: 'expenses', enabled: false }] },
    } } as any, { resolveAccess: async () => ({ companyId: 'company-1', permissions: ['ai.tool.invoke', 'expense.read'] }) } as any, new Map());
    assert.equal(await noExpensePermission.isReadFreeExpenseCriterionConfirmation(request, response), false);
    assert.equal(await allowed.isReadFreeExpenseCriterionConfirmation(request, response), true);
    assert.equal(await featureDisabled.isReadFreeExpenseCriterionConfirmation(request, response), false);
  });

  it('rechecks the current access proof on replay and never downgrades a malformed read proof', async () => {
    const recipient = { webhookEventId: 'event-1', lineUserId: 'line-user-1', chatId: 'line-user-1', channelId: 'channel-1' };
    const access = { companyId: 'company-1', membershipId: 'membership-1', roles: ['OWNER'], permissions: ['ai.tool.invoke'], scopes: {} };
    const currentFingerprint = resolvedLineDeliveryAccessFingerprint('user-1', 'company-1', access as any, null);
    const accessProof = { kind: 'expense_criterion_confirmation', userId: 'user-1', companyId: 'company-1', membershipId: 'membership-1',
      fingerprint: currentFingerprint, webhookEventId: 'event-1', recipientHash: lineDeliveryRecipientHash(recipient.lineUserId, recipient.chatId, recipient.channelId),
      channelId: 'channel-1', chatKeyHash: 'b'.repeat(16) };
    const prisma = { client: {
      externalIdentity: { findFirst: async () => ({ status: 'ACTIVE', userId: 'user-1', user: { status: 'ACTIVE', aiAssistantOptOutAt: null } }) },
      companyFeatureEntitlement: { findMany: async () => [] },
      lineCompanyContext: { findUnique: async () => null },
    } } as any;
    const service = new LineReadEvidenceService(prisma, { resolveAccess: async () => access } as any, new Map());
    const envelope = { v: 1, producerId: 'producer-1', access: accessProof };
    assert.equal(await service.verifyDelivery(envelope, recipient), true);
    assert.equal(await service.verifyDelivery({ ...envelope, access: { ...accessProof, fingerprint: 'stale' } }, recipient), false);
    assert.equal(await service.verifyDelivery({ ...envelope, read: { ids: [] } }, recipient), false);
  });
});

describe('delivered expense summary proof binding', () => {
  const chatKeyHash = 'c'.repeat(16);
  const period = (fromDate: string, toDate: string) => ({ span: fromDate.slice(0, 7), kind: 'month', fromDate, toDate, monthKey: fromDate.slice(0, 7), source: 'explicit', label: fromDate.slice(0, 7), assumptions: [] });
  const row = (fromDate: string, toDate: string, options: { branchId?: string; defaulted?: boolean; truncated?: boolean; chatKeyHash?: string } = {}) => ({
    toolName: 'expense.list_recent', membershipId: 'membership-1', inputJson: {
      input: { ...(options.defaulted ? {} : { fromDate, toDate }), ...(options.branchId ? { branchId: options.branchId } : {}) },
      chatKeyHash: options.chatKeyHash ?? chatKeyHash,
      expenseSummary: { fromDate, toDate, branchId: options.branchId ?? null, defaultedToCurrentMonth: options.defaulted ?? false,
        statusBasis: 'exclude_rejected_voided_v1', truncated: options.truncated ?? false },
    },
  });
  const request = (messageText: string, periods: unknown[] = [], deliveredExpenseSummary?: unknown) => ({
    requestId: 'request-1', messageText,
    userContext: { companyId: 'company-1', internalUserId: 'user-1', membershipId: 'membership-1', chatKeyHash },
    valueCandidates: { periods, dates: [], amounts: [] },
    ...(deliveredExpenseSummary ? { conversationContext: { windowMinutes: 15, maxTurns: 15, recentTurns: [], deliveredExpenseSummary } } : {}),
  }) as any;
  const response = (count: number) => ({ deterministicExpenseSummary: true, refused: false,
    toolCalls: Array.from({ length: count }, () => ({ name: 'expense.list_recent', status: 'ok' })) }) as any;
  const serviceFor = (rows: unknown[]) => new LineReadEvidenceService({ client: { lineReadEvidence: { findMany: async () => rows } } } as any, {} as any, new Map());

  it('preserves periodKey through a delivered summary and rejects conflicting or invalid periods', async () => {
    const evidence = row('2026-08-01', '2026-08-31');
    (evidence.inputJson as any).input = { periodKey: '2026-08' };
    assert.equal((await serviceFor([evidence]).deliveredExpenseSummaryForTurn(request('ยอดค่าใช้จ่ายเดือนสิงหาคม 2569', [period('2026-08-01', '2026-08-31')]), response(1)))?.ranges.length, 1);
    for (const input of [{ periodKey: '2026-13' }, { periodKey: '2026-09' }, { periodKey: '2026-08', fromDate: '2026-08-01' }]) {
      (evidence.inputJson as any).input = input;
      assert.equal(await serviceFor([evidence]).deliveredExpenseSummaryForTurn(request('ยอดค่าใช้จ่ายเดือนสิงหาคม 2569', [period('2026-08-01', '2026-08-31')]), response(1)), undefined);
    }
  });

  it('binds every requested period to one successful API evidence row', async () => {
    const periods = [period('2026-07-01', '2026-07-31'), period('2026-08-01', '2026-08-31')];
    const valid = await serviceFor([row('2026-07-01', '2026-07-31'), row('2026-08-01', '2026-08-31')])
      .deliveredExpenseSummaryForTurn(request('ค่าใช้จ่ายเดือนกรกฎาคมและสิงหาคม 2569', periods), response(2));
    assert.equal(valid?.ranges.length, 2);
    const missingPeriod = await serviceFor([row('2026-08-01', '2026-08-31')])
      .deliveredExpenseSummaryForTurn(request('ค่าใช้จ่ายเดือนกรกฎาคมและสิงหาคม 2569', periods), response(1));
    assert.equal(missingPeriod, undefined);
  });

  it('accepts an API-proven current-month default and rejects truncated or wrong-chat evidence', async () => {
    const defaulted = await serviceFor([row('2026-09-01', '2026-09-25', { defaulted: true })])
      .deliveredExpenseSummaryForTurn(request('ยอดค่าใช้จ่ายเท่าไร'), response(1));
    assert.equal(defaulted?.ranges[0]?.fromDate, '2026-09-01');
    const truncated = await serviceFor([row('2026-09-01', '2026-09-25', { defaulted: true, truncated: true })])
      .deliveredExpenseSummaryForTurn(request('ยอดค่าใช้จ่ายเท่าไร'), response(1));
    assert.equal(truncated, undefined);
    const wrongChat = await serviceFor([row('2026-09-01', '2026-09-25', { defaulted: true, chatKeyHash: 'd'.repeat(16) })])
      .deliveredExpenseSummaryForTurn(request('ยอดค่าใช้จ่ายเท่าไร'), response(1));
    assert.equal(wrongChat, undefined);
    const wrongMembership = { ...row('2026-09-01', '2026-09-25', { defaulted: true }), membershipId: 'membership-other' };
    const wrongMember = await serviceFor([wrongMembership]).deliveredExpenseSummaryForTurn(request('ยอดค่าใช้จ่ายเท่าไร'), response(1));
    assert.equal(wrongMember, undefined);
  });

  it('grounds explicit branch scope and permits a deliberate all-branches refresh', async () => {
    const branchPeriod = period('2026-08-01', '2026-08-31');
    const branchReq = request('ค่าใช้จ่ายเดือนสิงหาคม 2569 สาขา B', [branchPeriod]);
    const correctBranch = await serviceFor([row('2026-08-01', '2026-08-31', { branchId: 'B' })])
      .deliveredExpenseSummaryForTurn(branchReq, response(1));
    assert.equal(correctBranch?.ranges[0]?.branchId, 'B');
    const mismatchedBranch = await serviceFor([row('2026-08-01', '2026-08-31', { branchId: 'A' })])
      .deliveredExpenseSummaryForTurn(request('ค่าใช้จ่ายเดือนสิงหาคม 2569 สาขา B', [branchPeriod]), response(1));
    assert.equal(mismatchedBranch, undefined);

    const prior = { version: 1, deliveredAt: '2026-09-25T00:00:00.000Z', statusBasis: 'exclude_rejected_voided',
      ranges: [{ fromDate: '2026-08-01', toDate: '2026-08-31', branchId: 'A' }] };
    const allBranches = await serviceFor([row('2026-08-01', '2026-08-31')])
      .deliveredExpenseSummaryForTurn(request('ค่าใช้จ่ายเดือนสิงหาคม 2569 ทุกสาขา', [branchPeriod], prior), response(1));
    assert.equal(allBranches?.ranges[0]?.branchId, null);
    const staleBranch = await serviceFor([row('2026-08-01', '2026-08-31', { branchId: 'A' })])
      .deliveredExpenseSummaryForTurn(request('ค่าใช้จ่ายเดือนสิงหาคม 2569 ทุกสาขา', [branchPeriod], prior), response(1));
    assert.equal(staleBranch, undefined);
  });

  it('binds a Thai branch name with combining marks to the resolved branch id in ERP evidence', async () => {
    const branchPeriod = period('2026-08-01', '2026-08-31');
    const base = row('2026-08-01', '2026-08-31', { branchId: 'uuid-branch-a' });
    const inputJson = base.inputJson as Record<string, any>;
    const evidence = { ...base, inputJson: { ...inputJson,
      input: { ...inputJson['input'], branchId: 'สาธุประดิษฐ์' },
      expenseSummary: { ...inputJson['expenseSummary'], branchId: 'uuid-branch-a' },
    } };
    const delivered = await serviceFor([evidence]).deliveredExpenseSummaryForTurn(
      request('ค่าใช้จ่ายเดือนสิงหาคม 2569 สาขา สาธุประดิษฐ์', [branchPeriod]), response(1));
    assert.equal(delivered?.ranges[0]?.branchId, 'uuid-branch-a');
  });
});

describe('v2 public and action source boundaries', () => {
  const request = { requestId: 'request', userContext: { companyId: 'company', internalUserId: 'user' } } as any;
  const service = () => new LineReadEvidenceService({ client: { lineReadEvidence: { findMany: async () => [] } } } as any, {} as any, new Map());
  it('does not replay public lookup admission as an ERP read, but rejects a private source attached to it', async () => {
    const response = { toolsInvoked: ['public.lookup'], toolCalls: [{ name: 'public.lookup', status: 'ok' }], sourceRefs: [{ module: 'public', entityType: 'public_source' }] } as any;
    assert.deepEqual(await service().forTurn(request, response), []);
    assert.equal(await service().forTurn(request, { ...response, sourceRefs: [{ module: 'expenses', entityType: 'expense' }] }), null);
  });
  it('recognizes explicit draft ACTION locators only on reported draft tools', async () => {
    const response = { toolsInvoked: ['reimbursement.draft.get_options'], toolCalls: [{ name: 'reimbursement.draft.get_options', status: 'ok' }], sourceRefs: [{ module: 'reimbursements', entityType: 'reimbursement_draft_action', sourceType: 'ACTION' }] } as any;
    assert.deepEqual(await service().forTurn(request, response), []);
    assert.equal(await service().forTurn(request, { ...response, toolsInvoked: [], toolCalls: [] }), null);
    assert.equal(await service().forTurn(request, { ...response, sourceRefs: [{ ...response.sourceRefs[0], sourceType: 'ERP_READ' }] }), null);
  });
});

describe('exact aggregate read provenance compatibility', () => {
  it('records decimal strings without precision loss and refuses narrowed/partial summary reuse', async () => {
    let saved: any;
    const tx = { $executeRaw: async () => {}, lineReadEvidence: { count: async () => 0, create: async ({ data }: any) => { saved = data; return { id: 'proof' }; } } };
    const service = new LineReadEvidenceService({ client: { $transaction: async (fn: any) => fn(tx) } } as any, {} as any, new Map());
    const ctx = { companyId: 'company', userId: 'user', membershipId: 'member', requestId: 'request', locale: 'th-TH', chatKeyHash: 'a'.repeat(16) } as any;
    const result = { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-27T00:00:00.000Z', sourceRefs: [],
      data: { total: 1, summary: { countedItems: 1, cancelledCount: 0, totalAmount: '90071992547409.93' }, period: { fromDate: '2026-08-01', toDate: '2026-08-31', defaultedToCurrentMonth: false } },
      queryApplied: { timezone: 'Asia/Bangkok', dateBasis: 'expense_incurred_date', statusBasis: 'exclude_rejected_voided', dataset: 'operational_expense_records', filters: {} },
      completeness: { aggregate: 'complete' } } as any;
    await service.record(ctx, { periodKey: '2026-08' }, result);
    assert.equal(saved.inputJson.expenseSummary.fromDate, '2026-08-01');
    assert.equal(result.data.summary.totalAmount, '90071992547409.93');
    for (const changes of [{ queryApplied: { ...result.queryApplied, filters: { categoryId: 'travel' } } },
      { queryApplied: { ...result.queryApplied, statusBasis: 'CONFIRMED' } }, { completeness: { aggregate: 'partial' } }]) {
      await service.record(ctx, { periodKey: '2026-08' }, { ...result, ...changes });
      assert.equal(saved.inputJson.expenseSummary, undefined);
    }
  });
});
