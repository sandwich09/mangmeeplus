import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import {
  LedgerGetPeriodStatusTool,
  LedgerGetReportSummaryTool,
  ProcurementGetPurchaseOrderDetailTool,
  ProcurementGetSummaryTool,
  ProcurementSearchSuppliersTool,
} from './erp-procurement-ledger-tools.use-case';

const baseCtx = {
  requestId: 'r1', companyId: 'c1', userId: 'u1', membershipId: 'm1', roles: [],
  permissions: ['procurement.purchase_order.read', 'procurement.supplier.read', 'ledger.period.read', 'ledger.report.read'],
  branchIds: ['b1'], locale: 'th-TH',
};

const period = {
  id: 'period-1', companyId: 'c1', periodKey: '2026-07', startDate: '2026-07-01T00:00:00.000Z',
  endDate: '2026-07-31T00:00:00.000Z', status: 'OPEN', closedAt: null, reopenedAt: null,
};

describe('LINE ERP procurement and ledger tools', () => {
  it('denies all tools before calling their authoritative sources', async () => {
    let calls = 0;
    const source = { execute: async () => { calls += 1; return { data: [], total: 0, page: 1, pageSize: 10 }; }, aggregate: async () => { calls += 1; return {}; } } as any;
    const noPerms = { ...baseCtx, permissions: [] };
    const tools = [
      new ProcurementGetSummaryTool(source),
      new ProcurementSearchSuppliersTool(source),
      new ProcurementGetPurchaseOrderDetailTool(source),
      new LedgerGetPeriodStatusTool(source),
      new LedgerGetReportSummaryTool(source, source, source, source),
    ];
    for (const tool of tools) assert.equal((await tool.execute(noPerms, {})).status, 'forbidden');
    assert.equal(calls, 0);
  });

  it('returns exact PO record counts and currency-separated monetary aggregates', async () => {
    const filters: any[] = [];
    const tool = new ProcurementGetSummaryTool({ aggregate: async (_ctx: any, filter: any) => {
      filters.push(filter);
      return {
        asOf: new Date('2026-07-31T00:00:00Z'), total: 2,
        byStatus: [{ status: 'DRAFT', count: 2 }],
        byCurrency: [{ currency: 'THB', count: 2, totalAmount: '250.0000' }],
      };
    } } as any);
    const result = await tool.execute(baseCtx, { fromDate: '2026-07-01', toDate: '2026-07-31' });
    assert.equal(result.status, 'ok');
    assert.equal((result.data as any).total, 2);
    assert.equal((result.data as any).byStatus.DRAFT, 2);
    assert.equal((result.data as any).monetarySummaryAvailable, true);
    assert.deepEqual((result.data as any).totalsByCurrency, [{ currency: 'THB', count: 2, totalAmount: '250.0000' }]);
    assert.equal((result.data as any).basis, 'canonical_purchase_order_record_counts');
    assert.equal(filters.every((filter) => filter.branchId === undefined), true, 'ABAC scope is enforced by the source use case');
  });

  it('fails closed for a disallowed branch and supports all authorized branches', async () => {
    const source = { aggregate: async () => ({ asOf: new Date(), total: 0, byStatus: [], byCurrency: [] }) } as any;
    const tool = new ProcurementGetSummaryTool(source);
    assert.equal((await tool.execute(baseCtx, { branchId: 'b2' })).errorCode, 'BRANCH_SCOPE_DENIED');
    const multiBranch = { ...baseCtx, branchIds: ['b1', 'b2'] };
    const allAuthorized = await tool.execute(multiBranch);
    assert.equal(allAuthorized.status, 'ok');
    assert.equal((allAuthorized.data as any).branchId, null);
  });

  it('bounds supplier results and strips private contact/tax fields', async () => {
    const tool = new ProcurementSearchSuppliersTool({ execute: async () => ({
      total: 20, page: 1, pageSize: 10,
      data: Array.from({ length: 10 }, (_, index) => ({
        id: `s${index}`, supplierCode: `SUP-${index}`, displayNameSnapshot: `Supplier ${index}`,
        supplierType: 'DOMESTIC', status: 'ACTIVE', defaultCurrency: 'THB', taxId: 'secret', email: 'secret@example.com', phone: 'secret',
      })),
    }) } as any);
    const result = await tool.execute(baseCtx, { limit: 99, search: 'Supplier' });
    assert.equal((result.data as any).items.length, 10);
    assert.equal((result.data as any).items[0].taxId, undefined);
    assert.equal((result.data as any).items[0].email, undefined);
  });

  it('handles required id, not-found, branch ABAC, and bounded PO money detail honestly', async () => {
    const missingId = new ProcurementGetPurchaseOrderDetailTool({} as any);
    assert.equal(((await missingId.execute(baseCtx)).data as any).needsPurchaseOrderId, true);
    const notFound = new ProcurementGetPurchaseOrderDetailTool({ execute: async () => { throw new NotFoundException(); } } as any);
    const absent = await notFound.execute(baseCtx, { purchaseOrderId: 'missing' });
    assert.equal(absent.status, 'ok');
    assert.deepEqual(absent.data, { found: false });
    assert.equal(absent.errorCode, 'PURCHASE_ORDER_NOT_FOUND');
    assert.equal(absent.sourceRefs[0]?.permissionChecked, true);

    const record = {
      id: 'po1', purchaseOrderNumber: 'PO-1', status: 'ISSUED', supplierId: 's1', supplierSnapshotJson: { displayName: 'Supplier A' }, branchId: 'b1',
      orderDate: new Date('2026-07-01'), expectedDeliveryDate: undefined, currency: 'USD', subtotalAmount: '100.00', discountAmount: '0.00',
      taxableAmount: '100.00', vatAmount: '7.00', whtEstimateAmount: '0.00', grandTotalAmount: '107.00', receivedAmount: '0.00', billedAmount: '0.00',
      outstandingAmount: '107.00', matchingMode: 'TWO_WAY', postingStatus: 'NOT_POSTED', taxSyncStatus: 'NOT_SYNCED',
      lines: Array.from({ length: 25 }, (_, lineNumber) => ({ lineNumber, lineType: 'ITEM', description: `Line ${lineNumber}`, orderedQuantity: '1', receivedQuantity: '0', billedQuantity: '0', unitPrice: '4.00', lineTotalAmount: '4.00', vatAmount: '0.28' })),
    };
    const tool = new ProcurementGetPurchaseOrderDetailTool({ execute: async () => record } as any);
    const result = await tool.execute(baseCtx, { purchaseOrderId: 'po1' });
    assert.equal((result.data as any).currency, 'USD');
    assert.equal((result.data as any).grandTotalAmount, '107.00');
    assert.equal((result.data as any).lineCount, 25);
    assert.equal((result.data as any).lines.length, 20);
    const relatedResult = await tool.execute({
      ...baseCtx,
      permissions: ['procurement.purchase_order.read_related'],
    }, { purchaseOrderId: 'po1' });
    assert.equal((relatedResult.data as any).id, 'po1');
    const crossBranch = new ProcurementGetPurchaseOrderDetailTool({ execute: async () => ({ ...record, branchId: 'b2' }) } as any);
    assert.equal((await crossBranch.execute(baseCtx, { purchaseOrderId: 'po1' })).errorCode, 'BRANCH_SCOPE_DENIED');
  });

  it('returns ledger period status and reports missing periods honestly', async () => {
    const tool = new LedgerGetPeriodStatusTool({ execute: async () => [period] } as any);
    assert.equal(((await tool.execute(baseCtx)).data as any).needsPeriodKey, true);
    assert.equal(((await tool.execute(baseCtx, { periodKey: '2026-07' })).data as any).status, 'OPEN');
    const absent = await tool.execute(baseCtx, { periodKey: '2025-01' });
    assert.deepEqual(absent.data, { found: false });
    assert.equal(absent.errorCode, 'LEDGER_PERIOD_NOT_FOUND');
    assert.equal(absent.sourceRefs[0]?.permissionChecked, true);
  });

  it('uses only canonical ledger totals, preserves basis/period, and states the currency gap', async () => {
    let trialCalls = 0;
    let pnlCalls = 0;
    let balanceCalls = 0;
    const tool = new LedgerGetReportSummaryTool(
      { execute: async () => [period] } as any,
      { execute: async () => { trialCalls += 1; return { totalDebit: '100.0000', totalCredit: '100.0000', difference: '0.0000' }; } } as any,
      { execute: async () => { pnlCalls += 1; return { revenue: '70.0000', totalCost: '20.0000', grossProfit: '50.0000', totalExpense: '10.0000', taxExpense: '5.0000', netProfit: '35.0000' }; } } as any,
      { execute: async () => { balanceCalls += 1; return { totalAssets: '200.0000', totalLiabilities: '50.0000', totalEquity: '150.0000' }; } } as any,
    );
    const result = await tool.execute(baseCtx, { periodKey: '2026-07', reportType: 'profit_and_loss' });
    assert.equal(result.status, 'ok');
    assert.equal((result.data as any).periodKey, '2026-07');
    assert.equal((result.data as any).basis, 'canonical_ledger_account_balances');
    assert.equal((result.data as any).currency, null);
    assert.equal((result.data as any).profitAndLoss.netProfit, '35.0000');
    assert.deepEqual([trialCalls, pnlCalls, balanceCalls], [0, 1, 0]);
    const absent = await tool.execute(baseCtx, { periodKey: '2025-01' });
    assert.deepEqual(absent.data, { found: false });
    assert.equal(absent.errorCode, 'LEDGER_PERIOD_NOT_FOUND');
    assert.equal(absent.sourceRefs[0]?.permissionChecked, true);
  });
});

// Round 7A: accounting counterparties use the web's guards, independent of procurement.
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CounterpartySearchTool, CounterpartyGetDetailTool, CounterpartyActionPreviewTool, LineCounterpartyService, buildCounterpartyCard, parseCounterpartyControl } from '../line-counterparty.service';
import { CreateCounterpartyUseCase, GetCounterpartyUseCase, ListCounterpartiesUseCase, UpdateCounterpartyUseCase } from '../../../accounting-documents/application/use-cases/counterparty.use-case';
import { LineDraftPreviewStore } from '../../../expenses/application/services/line-draft-preview.store';
import { LINE_TOOL_REGISTRY, hasToolFeature, lineToolRegistryFor } from '@watchdog-bms/contracts';

function counterpartyFixture() {
  let writes = 0, creates = 0, epoch = 0;
  let features = [{ featureKey: 'expenses', enabled: true }];
  const row: any = { id: 'cp-r7a', companyId: 'co-r7a', type: 'BOTH', displayName: 'ร้าน X', taxId: '0105556000001', branchCode: '00000',
    billingAddressJson: { version: 2, addressText: 'ที่อยู่เดิม' }, entityKind: 'JURISTIC', status: 'ACTIVE', createdByUserId: 'someone-else', updatedAt: new Date(), createdAt: new Date() };
  const ctx: any = { requestId: 'r7a-request', userId: 'user-r7a', companyId: 'co-r7a', membershipId: 'member-r7a', authSubject: 'user-r7a',
    roles: [], permissions: ['accounting.counterparty.read', 'accounting.counterparty.manage'], scopes: { branchIds: ['branch-r7a'] }, authProvider: 'line' };
  const repo: any = {
    findCounterpartyById: async (company: string, id: string) => company === row.companyId && id === row.id ? row : null,
    counterpartyUsage: async () => ({ usageCounts: { bought: 0, sold: 0 } }), isCounterpartyReceiptUploader: async () => false,
    listCounterparties: async (company: string, page: number, pageSize: number, filter: any) => {
      assert.equal(company, row.companyId); assert.equal(page, 1); assert.equal(pageSize, 10); assert.ok((filter.search?.length ?? 0) <= 160);
      return { data: [row], total: 1 };
    },
    createCounterparty: async (input: any) => { creates++; writes++; Object.assign(row, input, { updatedAt: new Date(row.updatedAt.getTime() + 1) }); return row; },
    updateCounterparty: async (input: any) => {
      if (input.expectedUpdatedAt?.getTime() !== row.updatedAt.getTime()) throw new ConflictException();
      writes++; Object.assign(row, input, { updatedAt: new Date(row.updatedAt.getTime() + 1) }); return row;
    },
  };
  const prisma: any = { client: { companyFeatureEntitlement: { findMany: async () => features }, aiConversation: { findFirst: async ({ where }: any) =>
    where.companyId === ctx.companyId && where.userId === ctx.userId && where.membershipId === ctx.membershipId && where.chatKeyHash === 'r7a-chat'
      ? { id: 'conversation-r7a', lifecycleEpoch: epoch } : null } } };
  const audit: any = { log: async () => {} }, get = new GetCounterpartyUseCase(repo), store = new LineDraftPreviewStore<any>();
  const service = new LineCounterpartyService(prisma, get, new CreateCounterpartyUseCase(repo, audit), new UpdateCounterpartyUseCase(repo, audit), store, { aiGatewayInternalSecret: 'r7a-secret' } as any);
  return { ctx, row, repo, get, service, store, prisma, writes: () => writes, creates: () => creates,
    changeEpoch: () => epoch++, setFeatures: (value: typeof features) => { features = value; } };
}
function toolContext(ctx: any) { return { ...ctx, locale: 'th-TH', branchIds: ctx.scopes.branchIds, chatKeyHash: 'r7a-chat' }; }

describe('Round 7A counterparties', () => {
  it('offers registry tools to starter expenses or sales without procurement and keeps preview always on', () => {
    for (const name of ['counterparty.search', 'counterparty.get_detail', 'counterparty.action.preview']) {
      const meta = LINE_TOOL_REGISTRY.find(tool => tool.name === name)!;
      assert.ok(meta); assert.ok(hasToolFeature(meta, new Set(['expenses']))); assert.ok(hasToolFeature(meta, new Set(['sales_documents'])));
      assert.equal(hasToolFeature(meta, new Set(['procurement'])), false);
      assert.ok(lineToolRegistryFor({ draftEditEnabled: false }).some(tool => tool.name === name));
    }
  });
  it('bounds searches and delegates tax/name matching to the same web list use-case', async () => {
    const h = counterpartyFixture(), tool = new CounterpartySearchTool(new ListCounterpartiesUseCase(h.repo));
    assert.equal((await tool.execute(toolContext(h.ctx), { search: '0105'.repeat(100) })).status, 'ok');
    assert.equal((await tool.execute(toolContext({ ...h.ctx, permissions: ['procurement.supplier.read'] }), {})).status, 'forbidden');
  });
  it('reads company-wide identity under a branch-scoped actor and hides another tenant', async () => {
    const h = counterpartyFixture(), tool = new CounterpartyGetDetailTool(h.get);
    const answer = await tool.execute(toolContext(h.ctx), { counterpartyId: h.row.id });
    assert.equal(answer.status, 'ok'); assert.equal((answer.data as any).taxId, h.row.taxId); assert.equal((answer.data as any).branchCode, '00000');
    assert.equal((answer.data as any).addressText, 'ที่อยู่เดิม'); assert.equal((answer.data as any).entityKind, 'JURISTIC');
    assert.equal((await tool.execute(toolContext({ ...h.ctx, companyId: 'other-company' }), { counterpartyId: h.row.id })).status, 'forbidden');
  });
  it('allows the original creator with expense permission, while hiding an unrelated row', async () => {
    const h = counterpartyFixture(), actor = { ...h.ctx, permissions: ['expense.create'] };
    assert.equal((await new CounterpartyGetDetailTool(h.get).execute(toolContext(actor), { counterpartyId: h.row.id })).status, 'forbidden');
    h.row.createdByUserId = h.ctx.userId;
    const prepared = await h.service.preview(actor, 'r7a-chat', { action: 'UPDATE', counterpartyId: h.row.id, addressText: 'ที่อยู่ใหม่' });
    assert.ok(prepared.preview); assert.equal(h.writes(), 0);
    assert.equal((await h.service.apply(actor, 'r7a-chat', { action: 'counterparty_confirm', token: prepared.preview.token })).status, 'applied');
  });
  it('previews old → new, applies the web CAS on button press, and replays without a second write', async () => {
    const h = counterpartyFixture();
    const prepared = await h.service.preview(h.ctx, 'r7a-chat', { action: 'UPDATE', counterpartyId: h.row.id, addressText: 'ที่อยู่ใหม่', displayName: 'ร้านใหม่', entityKind: 'INDIVIDUAL' });
    assert.ok(prepared.preview); assert.equal(h.writes(), 0); assert.match(prepared.preview.lines.join('\n'), /ที่อยู่เดิม → ที่อยู่ใหม่/u);
    assert.match(JSON.stringify(buildCounterpartyCard(prepared.preview)), /counterparty_confirm/u);
    const control = parseCounterpartyControl({ action: 'counterparty_confirm', token: prepared.preview.token }); assert.ok(control);
    assert.equal((await h.service.apply(h.ctx, 'r7a-chat', control)).status, 'applied'); assert.equal(h.writes(), 1);
    assert.equal(h.row.displayName, 'ร้านใหม่'); assert.equal(h.row.entityKind, 'INDIVIDUAL');
    assert.equal((await h.service.apply(h.ctx, 'r7a-chat', control)).status, 'replayed'); assert.equal(h.writes(), 1);
  });
  it('creates only on press, and concurrent double presses create once', async () => {
    const h = counterpartyFixture();
    const prepared = await h.service.preview(h.ctx, 'r7a-chat', { action: 'CREATE', displayName: 'บริษัท เอ จำกัด', taxId: '0105556000001', branchCode: '00000' });
    assert.ok(prepared.preview); assert.equal(h.creates(), 0);
    const results = await Promise.all([1, 2].map(() => h.service.apply(h.ctx, 'r7a-chat', { action: 'counterparty_confirm', token: prepared.preview!.token })));
    assert.equal(results.filter(result => result.status === 'applied').length, 1); assert.equal(h.creates(), 1);
  });
  it('refuses stale data, entitlement removal and permission removal before applying', async () => {
    for (const reason of ['stale', 'feature', 'permission']) {
      const h = counterpartyFixture();
      const prepared = await h.service.preview(h.ctx, 'r7a-chat', { action: 'UPDATE', counterpartyId: h.row.id, addressText: 'ใหม่' }); assert.ok(prepared.preview);
      if (reason === 'stale') h.row.updatedAt = new Date(h.row.updatedAt.getTime() + 1);
      if (reason === 'feature') h.setFeatures([{ featureKey: 'expenses', enabled: false }]);
      if (reason === 'permission') h.ctx.permissions = ['accounting.counterparty.read'];
      assert.equal((await h.service.apply(h.ctx, 'r7a-chat', { action: 'counterparty_confirm', token: prepared.preview.token })).status, 'blocked', reason);
      assert.equal(h.writes(), 0);
    }
  });
  it('binds company, user, membership, chat, epoch, exact patch and expiry', async () => {
    for (const reason of ['company', 'user', 'membership', 'chat', 'epoch', 'patch', 'expiry', 'token']) {
      const h = counterpartyFixture(), prepared = await h.service.preview(h.ctx, 'r7a-chat', { action: 'CREATE', displayName: 'ร้านใหม่' }); assert.ok(prepared.preview);
      const ctx = { ...h.ctx }; let chat = 'r7a-chat', token = prepared.preview.token;
      if (reason === 'company') ctx.companyId = 'other'; if (reason === 'user') ctx.userId = 'other'; if (reason === 'membership') ctx.membershipId = 'other';
      if (reason === 'chat') chat = 'other'; if (reason === 'epoch') h.changeEpoch();
      if (reason === 'token') token = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
      if (reason === 'patch' || reason === 'expiry') {
        const entry = await h.store.load(h.ctx.companyId, 'counterparty:r7a-chat');
        if (reason === 'patch') entry.patch.displayName = 'tampered'; else entry.expiresAt = new Date(Date.now() - 1).toISOString();
        await h.store.save(entry);
      }
      assert.equal((await h.service.apply(ctx, chat, { action: 'counterparty_confirm', token })).status, 'blocked', reason); assert.equal(h.writes(), 0);
    }
  });
  it('validates Thai tax length, uses checksum warning, accepts web foreign IDs and rejects invalid branch/entity/address', async () => {
    for (const patch of [{ taxId: '1234' }, { taxId: 'a'.repeat(33) }, { branchCode: '123' }, { entityKind: 'UNKNOWN' }, { addressText: 'ก'.repeat(501) }]) {
      const h = counterpartyFixture(), prepared = await h.service.preview(h.ctx, 'r7a-chat', { action: 'CREATE', displayName: 'ร้าน', ...patch });
      assert.equal(prepared.preview, undefined); assert.equal(h.writes(), 0);
    }
    const h = counterpartyFixture();
    const warning = await h.service.preview(h.ctx, 'r7a-chat', { action: 'CREATE', displayName: 'ร้าน', taxId: '1111111111111' });
    assert.ok(warning.preview); assert.match(warning.preview.lines.join('\n'), /เลขท้ายไม่ตรงตามสูตร ตรวจอีกครั้ง หรือกดบันทึกถ้าแน่ใจค่ะ/u);
    const foreign = await h.service.preview(h.ctx, 'r7a-chat', { action: 'CREATE', displayName: 'ร้าน', taxId: 'GB123456789' }); assert.ok(foreign.preview);
    assert.equal((await h.service.apply(h.ctx, 'r7a-chat', { action: 'counterparty_cancel', token: foreign.preview.token })).status, 'cancelled'); assert.equal(h.writes(), 0);
    assert.equal(parseCounterpartyControl(`action=counterparty_confirm&action=counterparty_cancel&token=${foreign.preview.token}`), null);
  });
});

it('X3: counterparty preview keeps tax/branch identifiers, warns before save and returns the registered source', async () => {
  const h = counterpartyFixture();
  const tool = new CounterpartyActionPreviewTool(h.service);
  const result = await tool.execute(toolContext(h.ctx), { action: 'CREATE', displayName: 'บริษัท ทดสอบ จำกัด', taxId: '0105556000011', branchCode: '00000' });
  assert.equal(result.status, 'ok');
  const meta = LINE_TOOL_REGISTRY.find(tool => tool.name === result.toolName)!;
  assert.equal(result.sourceRefs.length, 1);
  assert.equal(result.sourceRefs[0]!.module, meta.sourceModule);
  assert.equal(result.sourceRefs[0]!.permissionChecked, true);
  assert.equal(result.sourceRefs[0]!.sourceType, undefined, 'preview uses the same read-source convention as expense.action.preview');
  const preview = (result.data as any).preview;
  const card: any = buildCounterpartyCard(preview);
  const body = card.contents.body.contents.map((line: any) => line.text).join('\n');
  assert.match(body, /เลขผู้เสียภาษี: ยังไม่มี → 0105556000011/u);
  assert.match(body, /สาขาภาษี: ยังไม่มี → 00000/u);
  assert.match(body, /เลขท้ายไม่ตรงตามสูตร ตรวจอีกครั้ง หรือกดบันทึกถ้าแน่ใจค่ะ/u);
  assert.doesNotMatch(body, /ไม่ผ่าน/u);
  assert.equal(card.contents.footer.contents[0].action.label, 'ยืนยันบันทึก');
  assert.equal(h.writes(), 0);
  assert.equal((await h.service.apply(h.ctx, 'r7a-chat', { action: 'counterparty_confirm', token: preview.token })).status, 'applied');
  assert.equal(h.row.taxId, '0105556000011'); assert.equal(h.writes(), 1);
  const updated = await h.service.preview(h.ctx, 'r7a-chat', { action: 'UPDATE', counterpartyId: h.row.id, taxId: '0105556000001' });
  assert.match(updated.preview!.lines.join('\n'), /เลขผู้เสียภาษี: 0105556000011 → 0105556000001/u);
});
