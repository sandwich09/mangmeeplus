import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_AI_EXPENSE_CRITERION_REPLIES } from '@watchdog-bms/contracts';
import { expenseBranchScopeRequested, isExpenseCriterionOnlyText, lineReadResultHash, LineReadEvidenceService, parseExpenseCriterionAccessAuthorization, readMemoryEvidence, thaiMonthMentions } from './line-read-evidence.service';
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

  it('R-U1: treats a status word after เฉพาะ/เอาเฉพาะ/ดูเฉพาะ (with or without ที่/รายการที่/อันที่) as a filter, not a branch', () => {
    const table: Array<[string, boolean]> = [
      ['แล้วยอดเดือนนี้ ถ้าเอาเฉพาะที่ยืนยันแล้วล่ะ', false],
      ['เอาเฉพาะยืนยันแล้ว', false],
      ['เอาเฉพาะที่จ่ายแล้ว', false],
      ['เอาเฉพาะยังไม่จ่าย', false],
      ['เอาเฉพาะที่ค้างจ่าย', false],
      ['เอาเฉพาะรายการที่อนุมัติ', false],
      ['เอาเฉพาะร่าง', false],
      ['เอาเฉพาะอันที่รอตรวจ', false],
      ['เอาเฉพาะปฏิเสธ', false],
      ['เอาเฉพาะที่ยกเลิก', false],
      ['ดูเฉพาะสาขาลาดพร้าว', true],
      ['เอาเฉพาะลาดพร้าว', true],
      ['เฉพาะกันยายน', false],
    ];
    for (const [text, expected] of table) assert.equal(expenseBranchScopeRequested(text), expected, text);
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

  it('spec §4 R-M1: record() also persists readMemory alongside expenseSummary', async () => {
    let saved: any;
    const tx = { $executeRaw: async () => {}, lineReadEvidence: { count: async () => 0, create: async ({ data }: any) => { saved = data; return { id: 'proof' }; } } };
    const service = new LineReadEvidenceService({ client: { $transaction: async (fn: any) => fn(tx) } } as any, {} as any, new Map());
    const ctx = { companyId: 'company', userId: 'user', membershipId: 'member', requestId: 'request', locale: 'th-TH', chatKeyHash: 'a'.repeat(16) } as any;
    const result = { toolName: 'expense.list_recent', status: 'ok', asOf: '2026-09-27T00:00:00.000Z', sourceRefs: [],
      data: { total: 1, summary: { countedItems: 1, cancelledCount: 0, totalAmount: '500.00' },
        period: { fromDate: '2026-08-01', toDate: '2026-08-31', defaultedToCurrentMonth: false },
        items: [{ id: 'e1', expenseDate: '2026-08-05T10:00:00.000Z', vendorNameSnapshot: 'ร้านสมใจ', grandTotalAmount: '500.00' }] },
      queryApplied: { timezone: 'Asia/Bangkok', period: { startDate: '2026-08-01', endDate: '2026-08-31', timezone: 'Asia/Bangkok', defaulted: false },
        branch: { mode: 'all_authorized', branchId: null }, dateBasis: 'expense_incurred_date', statusBasis: 'exclude_rejected_voided',
        dataset: 'operational_expense_records', filters: {} } } as any;
    await service.record(ctx, {}, result);
    assert.equal(saved.inputJson.readMemory.tool, 'expense.list_recent');
    assert.equal(saved.inputJson.readMemory.shownItems[0].id, 'e1');
    assert.equal(saved.inputJson.readMemory.shownItems[0].label, 'ร้านสมใจ');
    assert.equal(JSON.stringify(saved.inputJson.readMemory).match(/500/), null, 'R-M6: no amount reaches read memory');
  });
});

describe('read memory extraction (spec §4 R-M1)', () => {
  const asOf = '2026-09-27T09:00:00.000Z';
  const queryApplied = (over: Record<string, unknown> = {}) => ({
    timezone: 'Asia/Bangkok', period: { startDate: '2026-08-01', endDate: '2026-08-31', timezone: 'Asia/Bangkok', defaulted: false },
    branch: { mode: 'all_authorized', branchId: null }, dateBasis: 'expense_incurred_date', statusBasis: 'exclude_rejected_voided',
    dataset: 'operational_expense_records', filters: {}, ...over,
  });

  it('expense.list_recent: canonical filters from queryApplied (not the raw input), records in display order', () => {
    const memory = readMemoryEvidence({
      toolName: 'expense.list_recent', status: 'ok', asOf, sourceRefs: [],
      data: { total: 2, items: [
        { id: 'e1', expenseDate: '2026-08-05T10:00:00.000Z', vendorNameSnapshot: 'ร้านสมใจ' },
        { id: 'e2', expenseDate: '2026-08-02T10:00:00.000Z', vendorNameSnapshot: undefined },
      ] },
      queryApplied: queryApplied({ statusBasis: 'CONFIRMED', branch: { mode: 'selected', branchId: 'b1' },
        filters: { paymentStatus: 'UNPAID', categoryId: 'c1', categoryName: 'อาหาร', vendorId: 'v1', vendorName: 'ร้านสมใจ', branchName: 'สาขาลาดพร้าว' } }),
    } as any)!;
    assert.equal(memory.tool, 'expense.list_recent');
    assert.equal(memory.answerShape, 'list');
    assert.deepEqual(memory.period, { fromDate: '2026-08-01', toDate: '2026-08-31' });
    assert.equal(memory.documentStatus, 'CONFIRMED');
    assert.equal(memory.paymentStatus, 'UNPAID');
    assert.equal(memory.categoryId, 'c1');
    assert.equal(memory.categoryName, 'อาหาร');
    assert.equal(memory.vendorId, 'v1');
    assert.equal(memory.vendorName, 'ร้านสมใจ');
    assert.equal(memory.branchId, 'b1');
    assert.equal(memory.branchName, 'สาขาลาดพร้าว');
    assert.deepEqual(memory.shownItems, [
      { ordinal: 1, id: 'e1', label: 'ร้านสมใจ', date: '2026-08-05' },
      { ordinal: 2, id: 'e2', label: 'ไม่ระบุร้าน', date: '2026-08-02' },
    ]);
  });

  it('expense.list_recent: exclude_rejected_voided basis is never recorded as a documentStatus filter', () => {
    const memory = readMemoryEvidence({ toolName: 'expense.list_recent', status: 'ok', asOf, sourceRefs: [],
      data: { total: 0, items: [] }, queryApplied: queryApplied() } as any)!;
    assert.equal(memory.documentStatus, undefined);
    assert.equal(memory.shownItems, undefined);
  });

  it('expense.get_breakdown: groups by the effective groupBy, sorted descending, four groups plus remainder, null-id group dropped', () => {
    const groups = Array.from({ length: 9 }, (_, i) => ({ categoryId: `c${i}`, category: `หมวด${i}`, totalAmount: String(100 - i) }));
    groups.push({ categoryId: null as any, category: 'ไม่ระบุหมวด', totalAmount: '999' });
    const memory = readMemoryEvidence({
      toolName: 'expense.get_breakdown', status: 'ok', asOf, sourceRefs: [],
      data: { totalCount: 10, totalAmount: '1000.00', byCategory: groups, byBranch: [], byVendor: [] },
      queryApplied: queryApplied({ filters: { groupBy: 'category' } }),
    } as any)!;
    assert.equal(memory.groupBy, 'category');
    // The null-id row occupies the first display slot. Three named groups and the remainder
    // complete the five rows, so only c0..c2 are referenceable at display positions 2–4.
    assert.equal(memory.shownItems?.length, 3);
    assert.equal(memory.shownItems?.[0]?.id, 'c0');
    assert.equal(memory.shownItems?.[0]?.ordinal, 2, 'true display position, after the dropped null-id row');
    assert.equal(memory.shownItems?.every(item => item.kind === 'category'), true);
    assert.equal(memory.shownItems?.some(item => item.id === 'c7' || item.id === 'c8'), false, 'beyond the top-8 display window is folded into อื่นๆ, not remembered individually');
  });

  it('expense.get_breakdown: defaults to category when groupBy is absent', () => {
    const memory = readMemoryEvidence({
      toolName: 'expense.get_breakdown', status: 'ok', asOf, sourceRefs: [],
      data: { totalCount: 1, totalAmount: '10.00', byCategory: [{ categoryId: 'c1', category: 'อาหาร', totalAmount: '10.00' }], byBranch: [], byVendor: [] },
      queryApplied: queryApplied({ filters: {} }),
    } as any)!;
    assert.equal(memory.groupBy, undefined);
    assert.equal(memory.shownItems?.[0]?.kind, 'category');
  });

  it('expense.get_detail: remembers the one resolved record, no period/filters', () => {
    const memory = readMemoryEvidence({
      toolName: 'expense.get_detail', status: 'ok', asOf, sourceRefs: [],
      data: { id: 'e1', vendorName: 'ร้านสมใจ', expenseDate: '2026-08-05T10:00:00.000Z', grandTotalAmount: '500.00' },
    } as any)!;
    assert.equal(memory.answerShape, 'single_metric');
    assert.deepEqual(memory.shownItems, [{ ordinal: 1, id: 'e1', label: 'ร้านสมใจ', date: '2026-08-05' }]);
    assert.equal(memory.period, undefined);
  });

  it('reimbursement.get_detail: remembers the one resolved record by requester', () => {
    const memory = readMemoryEvidence({
      toolName: 'reimbursement.get_detail', status: 'ok', asOf, sourceRefs: [],
      data: { id: 'r1', requesterDisplayName: 'สมชาย', incurredDate: '2026-08-05', amount: '1500.00' },
    } as any)!;
    assert.deepEqual(memory.shownItems, [{ ordinal: 1, id: 'r1', label: 'สมชาย', date: '2026-08-05' }]);
  });

  it('expense.get_daily_closing: remembers the day as a one-day period, no shownItems', () => {
    const memory = readMemoryEvidence({
      toolName: 'expense.get_daily_closing', status: 'ok', asOf, sourceRefs: [],
      data: { date: '2026-08-16', timezone: 'Asia/Bangkok' },
    } as any)!;
    assert.equal(memory.answerShape, 'single_metric');
    assert.deepEqual(memory.period, { fromDate: '2026-08-16', toDate: '2026-08-16' });
    assert.equal(memory.shownItems, undefined);
  });

  it('expense.list_substitute_receipts_to_sign: remembers the list only — no status basis, filter or item to inherit', () => {
    const memory = readMemoryEvidence({
      toolName: 'expense.list_substitute_receipts_to_sign', status: 'ok', asOf, sourceRefs: [],
      data: { accessScope: 'own', total: 1, asPayer: { count: 1, items: [{ documentNumber: 'SRC-1', payeeName: 'ร้านป้าแดง', amount: '350' }] } },
      queryApplied: { statusBasis: 'waiting_for_caller_signature_or_approval', filters: { role: 'payer' } },
    } as any)!;
    assert.deepEqual(memory, { tool: 'expense.list_substitute_receipts_to_sign', answerShape: 'list', asOf });
  });

  it('reimbursement.list_pending_approvals: shownItems in the tool\'s own order, no queryApplied needed', () => {
    const memory = readMemoryEvidence({
      toolName: 'reimbursement.list_pending_approvals', status: 'ok', asOf, sourceRefs: [],
      data: { total: 2, items: [
        { id: 'r1', requesterDisplayName: 'สมชาย', submittedAt: '2026-08-05T10:00:00.000Z', amount: '1500.00' },
        { id: 'r2', requesterDisplayName: 'สมหญิง', submittedAt: '2026-08-06T10:00:00.000Z', amount: '2500.00' },
      ] },
    } as any)!;
    assert.equal(memory.answerShape, 'list');
    assert.deepEqual(memory.shownItems, [
      { ordinal: 1, id: 'r1', label: 'สมชาย', date: '2026-08-05' },
      { ordinal: 2, id: 'r2', label: 'สมหญิง', date: '2026-08-06' },
    ]);
  });

  it('reimbursement.get_approval_backlog: the listed claims by document number, never its status basis or amounts', () => {
    const memory = readMemoryEvidence({
      toolName: 'reimbursement.get_approval_backlog', status: 'ok', asOf, sourceRefs: [],
      data: { total: 2, byApprover: [], sharedPile: null, desks: [], items: [
        { id: 'r1', documentNumber: 'RB-001', requesterName: 'สมชาย', amount: '1500.00', waitingOn: 'สมศรี', submittedOn: '2026-08-05', waitDays: 3 },
        { id: 'r2', documentNumber: null, requesterName: 'สมหญิง', amount: '2500.00', waitingOn: 'ฝ่ายการเงิน', submittedOn: '2026-08-06', waitDays: 2 },
      ] },
      queryApplied: { timezone: 'Asia/Bangkok', dateBasis: 'submitted_or_approved_thai_day', statusBasis: 'waiting_claims', dataset: 'reimbursement_requests', accessScope: 'own' },
    } as any)!;
    assert.deepEqual(memory, { tool: 'reimbursement.get_approval_backlog', answerShape: 'list', asOf, shownItems: [
      { ordinal: 1, id: 'r1', label: 'RB-001', date: '2026-08-05' },
      { ordinal: 2, id: 'r2', label: 'ใบเบิก', date: '2026-08-06' },
    ] });
  });

  it('reimbursement.get_summary: no shownItems, single_metric', () => {
    const memory = readMemoryEvidence({
      toolName: 'reimbursement.get_summary', status: 'ok', asOf, sourceRefs: [],
      data: { pendingApprovalCount: 3, unpaidApprovedCount: 5, overdueApprovalCount: 2, totalUnpaidAmount: '12500.00' },
    } as any)!;
    assert.equal(memory.answerShape, 'single_metric');
    assert.equal(memory.shownItems, undefined);
  });

  it('returns undefined for a tool outside the memory set, a failed/forbidden result, or a malformed shape', () => {
    assert.equal(readMemoryEvidence({ toolName: 'sales.get_sales_summary', status: 'ok', asOf, sourceRefs: [], data: { totalSales: '100' } } as any), undefined);
    assert.equal(readMemoryEvidence({ toolName: 'expense.list_recent', status: 'forbidden', asOf, sourceRefs: [] } as any), undefined);
    assert.equal(readMemoryEvidence({ toolName: 'expense.list_recent', status: 'ok', asOf, sourceRefs: [], data: null } as any), undefined);
    assert.equal(readMemoryEvidence({ toolName: 'expense.get_detail', status: 'ok', asOf: 'not-a-date', sourceRefs: [], data: { id: 'e1' } } as any), undefined);
  });

  it('spec §4 R-M6: no field name or value anywhere in extracted memory ever carries a money amount', () => {
    const memory = readMemoryEvidence({
      toolName: 'expense.list_recent', status: 'ok', asOf, sourceRefs: [],
      data: { total: 1, summary: { totalAmount: '999999.99' }, items: [{ id: 'e1', expenseDate: '2026-08-05T10:00:00.000Z', vendorNameSnapshot: 'ร้านสมใจ', grandTotalAmount: '999999.99' }] },
      queryApplied: queryApplied(),
    } as any)!;
    const serialized = JSON.stringify(memory);
    assert.doesNotMatch(serialized, /999999/);
    assert.doesNotMatch(serialized, /[Aa]mount/);
  });
});

describe('recentReadsForTurn (spec §4 R-M2/R-M7)', () => {
  const chatKeyHash = 'e'.repeat(16);
  const request = (over: Record<string, unknown> = {}) => ({
    requestId: 'request-1',
    userContext: { companyId: 'company-1', internalUserId: 'user-1', membershipId: 'membership-1', chatKeyHash, ...((over as any).userContext ?? {}) },
    ...over,
  }) as any;
  const memoryRow = (tool: string, over: Record<string, unknown> = {}) => ({
    toolName: tool, membershipId: 'membership-1',
    inputJson: { chatKeyHash, readMemory: { tool, answerShape: 'list', asOf: '2026-09-27T09:00:00.000Z', ...over } },
  });
  const serviceFor = (rows: unknown[]) => new LineReadEvidenceService({ client: { lineReadEvidence: { findMany: async () => rows } } } as any, {} as any, new Map());

  it('returns this turn\'s own memory entries for tool calls the response reports as ok', async () => {
    const response = { refused: false, toolCalls: [{ name: 'expense.list_recent', status: 'ok' }] } as any;
    const entries = await serviceFor([memoryRow('expense.list_recent')]).recentReadsForTurn(request(), response);
    assert.equal(entries?.length, 1);
    assert.equal(entries?.[0]?.tool, 'expense.list_recent');
  });

  it('spec R-M7: a group/room chat (no chatKeyHash) never gets memory', async () => {
    const response = { refused: false, toolCalls: [{ name: 'expense.list_recent', status: 'ok' }] } as any;
    const groupRequest = { requestId: 'request-1', userContext: { companyId: 'company-1', internalUserId: 'user-1', membershipId: 'membership-1' } } as any;
    assert.equal(await serviceFor([memoryRow('expense.list_recent')]).recentReadsForTurn(groupRequest, response), undefined);
  });

  it('a refused turn never gets memory', async () => {
    const response = { refused: true, toolCalls: [] } as any;
    assert.equal(await serviceFor([]).recentReadsForTurn(request(), response), undefined);
  });

  it('no qualifying evidence rows returns an empty array, not undefined', async () => {
    const response = { refused: false, toolCalls: [{ name: 'sales.get_sales_summary', status: 'ok' }] } as any;
    assert.deepEqual(await serviceFor([]).recentReadsForTurn(request(), response), []);
  });

  it('a stored row the gateway did not report as a successful call makes the whole result untrusted', async () => {
    const response = { refused: false, toolCalls: [{ name: 'expense.list_recent', status: 'error' }] } as any;
    assert.equal(await serviceFor([memoryRow('expense.list_recent')]).recentReadsForTurn(request(), response), undefined);
  });

  it('an access-scope change (membership) since the read makes the whole result untrusted', async () => {
    const response = { refused: false, toolCalls: [{ name: 'expense.list_recent', status: 'ok' }] } as any;
    const wrongMembership = { ...memoryRow('expense.list_recent'), membershipId: 'membership-other' };
    assert.equal(await serviceFor([wrongMembership]).recentReadsForTurn(request(), response), undefined);
  });

  it('a chat mismatch on the stored row makes the whole result untrusted', async () => {
    const response = { refused: false, toolCalls: [{ name: 'expense.list_recent', status: 'ok' }] } as any;
    const row = memoryRow('expense.list_recent');
    (row.inputJson as any).chatKeyHash = 'f'.repeat(16);
    assert.equal(await serviceFor([row]).recentReadsForTurn(request(), response), undefined);
  });
});

describe('lineReadResultHash (item 1: daily-closing delivery re-verification)', () => {
  // expense.get_daily_closing's data.observability.queryDurationMs is real per-call DB timing —
  // re-running the exact same query for LineReadEvidenceService.verify() always measures a
  // different duration even when nothing about the underlying rows changed. Before this field was
  // excluded, that made every daily-closing answer fail its own delivery re-verification and get
  // denied with LINE_DELIVERY_SOURCE_CHANGED regardless of whether the source actually changed.
  const dailyClosing = (over: Record<string, unknown> = {}) => ({
    toolName: 'expense.get_daily_closing', status: 'ok', asOf: '2026-09-28T10:00:00.000Z',
    sourceRefs: [{ label: 'สรุปปิดร้าน', module: 'expenses', entityType: 'expense_daily_closing', asOf: '2026-09-28T10:00:00.000Z', permissionChecked: true }],
    data: {
      date: '2026-09-28', occurredToday: { totals: [{ currency: 'THB', count: 1, total: '100.0000' }] },
      observability: { queryDurationMs: 12, queryCount: 16, truncated: false },
      ...over,
    },
  } as any);

  it('ignores queryDurationMs so an unchanged read verifies even when the DB round-trip timing differs', () => {
    const first = dailyClosing();
    const secondsLater = dailyClosing({ observability: { queryDurationMs: 341, queryCount: 16, truncated: false } });
    assert.equal(lineReadResultHash(secondsLater), lineReadResultHash(first));
  });

  it('still catches a real change: totals, queryCount, and truncated all move the hash', () => {
    const first = dailyClosing();
    const newExpense = dailyClosing({ occurredToday: { totals: [{ currency: 'THB', count: 2, total: '250.0000' }] } });
    const differentQueryCount = dailyClosing({ observability: { queryDurationMs: 12, queryCount: 17, truncated: false } });
    const nowTruncated = dailyClosing({ observability: { queryDurationMs: 12, queryCount: 16, truncated: true } });
    assert.notEqual(lineReadResultHash(newExpense), lineReadResultHash(first));
    assert.notEqual(lineReadResultHash(differentQueryCount), lineReadResultHash(first));
    assert.notEqual(lineReadResultHash(nowTruncated), lineReadResultHash(first));
  });

  it('leaves a tool result with no observability field untouched', () => {
    const withoutObservability = { toolName: 'expense.get_detail', status: 'ok', asOf: 'a', sourceRefs: [], data: { id: 'e1' } } as any;
    assert.equal(lineReadResultHash(withoutObservability), lineReadResultHash({ ...withoutObservability, asOf: 'b' }));
  });
});
