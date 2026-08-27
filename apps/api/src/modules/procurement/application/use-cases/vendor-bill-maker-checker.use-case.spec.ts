import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { ApproveVendorBillUseCase, SubmitVendorBillUseCase, ReviewVendorBillTaxEvidenceUseCase } from './vendor-bill.use-case';
import { CreateSupplierPaymentUseCase } from './supplier-payment.use-case';
import { GetProcurementApprovalPolicyUseCase, UpdateProcurementApprovalPolicyUseCase } from './approval-policy.use-case';
import { vendorBillTaxSourceChecksum } from '../../domain/logic/procurement.logic';

// H-07 closure evidence: the submitter of a vendor bill cannot approve it,
// bills at/above the configurable threshold need two approvers other than the
// submitter (approvals pinned to bill content), and releasing a supplier
// payment needs the separate release permission.

const approveCtx = (userId: string, roles: string[] = ['FINANCE']): any => ({
  companyId: 'co_1', userId, requestId: 'req_1', roles,
  permissions: ['procurement.vendor_bill.approve'],
});

function bill(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'bill_1', companyId: 'co_1', branchId: null, status: 'PENDING_APPROVAL',
    supplierId: 'sup_1', billDate: new Date('2026-07-01'), currency: 'THB',
    pp36Candidate: false, matchingMode: 'NONE', matchingStatus: 'NOT_REQUIRED',
    grandTotalAmount: '1500.00', netPayableAmount: '1500.00', paidAmount: '0',
    outstandingAmount: '1500.00', createdByUserId: 'u_creator', updatedAt: new Date('2026-07-02'),
    taxEvidenceRequired: false, taxEvidenceReviewStatus: 'DRAFT',
    lines: [],
    ...overrides,
  };
}

const BILL_CHECKSUM = vendorBillTaxSourceChecksum(bill());

const event = (action: string, actorUserId: string, createdAt: string, sourceChecksum: string | undefined = BILL_CHECKSUM) => ({
  id: `ev_${action}_${actorUserId}_${createdAt}`, companyId: 'co_1', sourceType: 'VENDOR_BILL' as const,
  sourceId: 'bill_1', action, actorUserId, createdAt: new Date(createdAt),
  thresholdSnapshotJson: action === 'APPROVED' ? { sourceChecksum } : undefined,
});

describe('ApproveVendorBillUseCase maker-checker (H-07)', () => {
  let repo: any;
  let audit: any;
  let outbox: any;

  beforeEach(() => {
    audit = { log: mock.fn(async () => undefined) };
    outbox = { append: mock.fn(async () => undefined) };
    repo = {
      findVendorBillById: mock.fn(async () => bill()),
      getProcurementApprovalPolicy: mock.fn(async () => null),
      listPurchaseApprovalEvents: mock.fn(async () => [event('SUBMITTED', 'u1', '2026-07-02T01:00:00Z')]),
      appendPurchaseApprovalEvent: mock.fn(async () => undefined),
      finalizeVendorBillApprovalCas: mock.fn(async () => ({ bill: bill({ status: 'APPROVED' }), finalized: [] })),
    };
  });

  const make = () => new ApproveVendorBillUseCase(repo, audit, outbox, {} as any);

  it('blocks the submitter from approving their own bill by default', async () => {
    await assert.rejects(() => make().execute(approveCtx('u1'), 'bill_1'), (error: any) => {
      assert.ok(error instanceof ForbiddenException);
      assert.equal((error.getResponse() as any).code, 'vendor_bill_self_approval_blocked');
      return true;
    });
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 0);
    assert.equal(repo.appendPurchaseApprovalEvent.mock.callCount(), 0);
  });

  it('falls back to the bill creator as submitter when no SUBMITTED event exists', async () => {
    repo.listPurchaseApprovalEvents = mock.fn(async () => []);
    await assert.rejects(() => make().execute(approveCtx('u_creator'), 'bill_1'), ForbiddenException);
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 0);
  });

  it('lets the submitter approve a single-approver bill when policy allows self-approval', async () => {
    repo.getProcurementApprovalPolicy = mock.fn(async () => ({ allowSelfApproval: true, dualApprovalThresholdAmount: null }));
    const result = await make().execute(approveCtx('u1'), 'bill_1');
    assert.equal(result.status, 'APPROVED');
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 1);
  });

  it('lets OWNER/ADMIN/MANAGER self-approve without a policy override (small-company exemption)', async () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER']) {
      repo.finalizeVendorBillApprovalCas = mock.fn(async () => ({ bill: bill({ status: 'APPROVED' }), finalized: [] }));
      const result = await make().execute(approveCtx('u1', [role]), 'bill_1');
      assert.equal(result.status, 'APPROVED', `role ${role} should self-approve`);
      assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 1);
    }
    // ...while a non-exempt role stays blocked.
    await assert.rejects(() => make().execute(approveCtx('u1', ['FINANCE']), 'bill_1'), ForbiddenException);
    // The audit row marks the self-approval explicitly.
    const finalAudit = (audit.log.mock.calls.at(-1) as any).arguments[0];
    assert.equal(finalAudit.metadataJson.selfApproved, true);
  });

  it('still requires two non-submitter approvers above the threshold, even for an OWNER submitter', async () => {
    repo.getProcurementApprovalPolicy = mock.fn(async () => ({ allowSelfApproval: false, dualApprovalThresholdAmount: '1000.00' }));
    await assert.rejects(() => make().execute(approveCtx('u1', ['OWNER']), 'bill_1'), (error: any) => {
      assert.ok(error instanceof ConflictException);
      assert.equal((error.getResponse() as any).code, 'vendor_bill_dual_approval_pending');
      return true;
    });
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 0);
  });

  it('never lets the submitter satisfy the dual-approval quota, even with self-approval allowed', async () => {
    repo.getProcurementApprovalPolicy = mock.fn(async () => ({ allowSelfApproval: true, dualApprovalThresholdAmount: '1000.00' }));
    await assert.rejects(() => make().execute(approveCtx('u1'), 'bill_1'), (error: any) => {
      assert.ok(error instanceof ConflictException);
      assert.equal((error.getResponse() as any).code, 'vendor_bill_dual_approval_pending');
      return true;
    });
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 0);
    assert.equal(repo.appendPurchaseApprovalEvent.mock.callCount(), 0);
  });

  it('lets a different approver finalize a below-threshold bill in one step', async () => {
    repo.getProcurementApprovalPolicy = mock.fn(async () => ({ allowSelfApproval: false, dualApprovalThresholdAmount: '99999.00' }));
    const result = await make().execute(approveCtx('u2'), 'bill_1');
    assert.equal(result.status, 'APPROVED');
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 1);
    const appended = (repo.appendPurchaseApprovalEvent.mock.calls[0] as any).arguments;
    assert.equal(appended[3], 'APPROVED');
    assert.equal(appended[6].requiredApprovers, 1);
    assert.equal(appended[6].sourceChecksum, BILL_CHECKSUM);
    const finalAudit = (audit.log.mock.calls[0] as any).arguments[0];
    assert.deepEqual(finalAudit.metadataJson.dualApproval, { recorded: 1, required: 1, final: true });
    assert.equal(finalAudit.metadataJson.submitterUserId, 'u1');
  });

  it('records a partial approval without finalizing when the dual threshold is met', async () => {
    repo.getProcurementApprovalPolicy = mock.fn(async () => ({ allowSelfApproval: false, dualApprovalThresholdAmount: '1000.00' }));
    const result = await make().execute(approveCtx('u2'), 'bill_1');
    assert.equal(result.status, 'PENDING_APPROVAL');
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 0);
    assert.equal(repo.appendPurchaseApprovalEvent.mock.callCount(), 1);
    const snapshot = (repo.appendPurchaseApprovalEvent.mock.calls[0] as any).arguments[6];
    assert.equal(snapshot.requiredApprovers, 2);
    assert.equal(snapshot.submitterUserId, 'u1');
    assert.equal(snapshot.sourceChecksum, BILL_CHECKSUM);
    assert.equal((outbox.append.mock.calls[0] as any).arguments[0], 'vendor_bill.approval_recorded');
    // The event data carries the ids the second-approval workflow template
    // needs to notify remaining approvers and exclude submitter + prior approvers.
    const eventData = (outbox.append.mock.calls[0] as any).arguments[3].data;
    assert.equal(eventData.billId, 'bill_1');
    assert.equal(eventData.submitterUserId, 'u1');
    assert.deepEqual(eventData.approverUserIds, ['u2']);
    assert.equal(eventData.requiredApprovers, 2);
    assert.deepEqual((audit.log.mock.calls[0] as any).arguments[0].metadataJson.dualApproval, { recorded: 1, required: 2, final: false });
  });

  it('rejects the same approver approving twice while dual approval is pending', async () => {
    repo.getProcurementApprovalPolicy = mock.fn(async () => ({ allowSelfApproval: false, dualApprovalThresholdAmount: '1000.00' }));
    repo.listPurchaseApprovalEvents = mock.fn(async () => [
      event('SUBMITTED', 'u1', '2026-07-02T01:00:00Z'),
      event('APPROVED', 'u2', '2026-07-02T02:00:00Z'),
    ]);
    await assert.rejects(() => make().execute(approveCtx('u2'), 'bill_1'), (error: any) => {
      assert.ok(error instanceof ConflictException);
      assert.equal((error.getResponse() as any).code, 'vendor_bill_dual_approval_pending');
      return true;
    });
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 0);
  });

  it('lets a second distinct approver finalize an above-threshold bill', async () => {
    repo.getProcurementApprovalPolicy = mock.fn(async () => ({ allowSelfApproval: false, dualApprovalThresholdAmount: '1000.00' }));
    repo.listPurchaseApprovalEvents = mock.fn(async () => [
      event('SUBMITTED', 'u1', '2026-07-02T01:00:00Z'),
      event('APPROVED', 'u2', '2026-07-02T02:00:00Z'),
    ]);
    const result = await make().execute(approveCtx('u3'), 'bill_1');
    assert.equal(result.status, 'APPROVED');
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 1);
    assert.deepEqual((audit.log.mock.calls[0] as any).arguments[0].metadataJson.dualApproval, { recorded: 2, required: 2, final: true });
  });

  it('ignores prior approvals recorded for different bill content (stale round)', async () => {
    repo.getProcurementApprovalPolicy = mock.fn(async () => ({ allowSelfApproval: false, dualApprovalThresholdAmount: '1000.00' }));
    repo.listPurchaseApprovalEvents = mock.fn(async () => [
      event('SUBMITTED', 'u1', '2026-07-02T01:00:00Z'),
      // u2 approved a different version of the bill (edited after a
      // reject→resubmit, or an append that raced into this round).
      event('APPROVED', 'u2', '2026-07-02T02:00:00Z', 'stale-checksum'),
    ]);
    const result = await make().execute(approveCtx('u3'), 'bill_1');
    assert.equal(result.status, 'PENDING_APPROVAL');
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 0);
  });

  it('never counts the submitter toward the dual-approval quota', async () => {
    repo.getProcurementApprovalPolicy = mock.fn(async () => ({ allowSelfApproval: false, dualApprovalThresholdAmount: '1000.00' }));
    repo.listPurchaseApprovalEvents = mock.fn(async () => [
      event('SUBMITTED', 'u1', '2026-07-02T01:00:00Z'),
      event('APPROVED', 'u1', '2026-07-02T02:00:00Z'),
    ]);
    const result = await make().execute(approveCtx('u2'), 'bill_1');
    assert.equal(result.status, 'PENDING_APPROVAL');
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 0);
  });

  it('resets the approval round after a resubmission', async () => {
    repo.getProcurementApprovalPolicy = mock.fn(async () => ({ allowSelfApproval: false, dualApprovalThresholdAmount: '1000.00' }));
    repo.listPurchaseApprovalEvents = mock.fn(async () => [
      event('SUBMITTED', 'u1', '2026-07-02T01:00:00Z'),
      event('APPROVED', 'u2', '2026-07-02T02:00:00Z'),
      event('REJECTED', 'u3', '2026-07-02T03:00:00Z'),
      event('SUBMITTED', 'u3', '2026-07-02T04:00:00Z'),
    ]);
    // u2's approval belongs to the previous round; a fresh partial is recorded.
    const result = await make().execute(approveCtx('u2'), 'bill_1');
    assert.equal(result.status, 'PENDING_APPROVAL');
    assert.equal(repo.finalizeVendorBillApprovalCas.mock.callCount(), 0);
    // ...and the new submitter u3 is now the one who is blocked.
    await assert.rejects(() => make().execute(approveCtx('u3'), 'bill_1'), ForbiddenException);
  });

  it('re-verifies the dual-approval quota inside the finalize transaction', async () => {
    repo.getProcurementApprovalPolicy = mock.fn(async () => ({ allowSelfApproval: false, dualApprovalThresholdAmount: '1000.00' }));
    repo.listPurchaseApprovalEvents = mock.fn(async () => [
      event('SUBMITTED', 'u1', '2026-07-02T01:00:00Z'),
      event('APPROVED', 'u2', '2026-07-02T02:00:00Z'),
    ]);
    // In-transaction trail no longer contains u2's content-matching approval
    // (e.g. it belonged to content that changed under a concurrent resubmit).
    const staleDb = { purchaseApprovalEvent: { findMany: mock.fn(async () => [
      event('SUBMITTED', 'u1', '2026-07-02T01:00:00Z'),
      event('APPROVED', 'u2', '2026-07-02T02:00:00Z', 'stale-checksum'),
    ]) } };
    repo.finalizeVendorBillApprovalCas = mock.fn(async (_input: any, finalizeTax: any) => {
      await finalizeTax({ db: staleDb, bill: bill() });
      return { bill: bill({ status: 'APPROVED' }), finalized: [] };
    });
    await assert.rejects(() => make().execute(approveCtx('u3'), 'bill_1'), ConflictException);

    // Happy path: the in-transaction trail confirms the quota.
    const freshDb = { purchaseApprovalEvent: { findMany: mock.fn(async () => [
      event('SUBMITTED', 'u1', '2026-07-02T01:00:00Z'),
      event('APPROVED', 'u2', '2026-07-02T02:00:00Z'),
    ]) } };
    repo.finalizeVendorBillApprovalCas = mock.fn(async (_input: any, finalizeTax: any) => {
      await finalizeTax({ db: freshDb, bill: bill() });
      return { bill: bill({ status: 'APPROVED' }), finalized: [] };
    });
    const result = await make().execute(approveCtx('u3'), 'bill_1');
    assert.equal(result.status, 'APPROVED');
    assert.equal(freshDb.purchaseApprovalEvent.findMany.mock.callCount(), 1);
  });
});

describe('Submit → approve → pay audit chain (H-07)', () => {
  it('submit persists the submitter as a SUBMITTED event before the status change', async () => {
    const order: string[] = [];
    const repo: any = {
      findVendorBillById: mock.fn(async () => bill({ status: 'DRAFT' })),
      updateVendorBillStatus: mock.fn(async () => { order.push('status'); return bill({ vendorBillNumber: 'VB-1' }); }),
      appendPurchaseApprovalEvent: mock.fn(async () => { order.push('event'); }),
    };
    const audit = { log: mock.fn(async () => undefined) };
    const outbox = { append: mock.fn(async () => undefined) };
    const reserveNumber = { execute: mock.fn(async () => ({ id: 'num_1', documentNumber: 'VB-1' })) };
    const commitNumber = { execute: mock.fn(async () => undefined) };
    const useCase = new SubmitVendorBillUseCase(repo, audit as any, outbox as any, reserveNumber as any, commitNumber as any);
    await useCase.execute({ companyId: 'co_1', userId: 'u1', requestId: 'req_1', permissions: ['procurement.vendor_bill.create'] } as any, 'bill_1');
    const appended = (repo.appendPurchaseApprovalEvent.mock.calls[0] as any).arguments;
    assert.equal(appended[3], 'SUBMITTED');
    assert.equal(appended[4], 'u1');
    // A stray SUBMITTED event on a DRAFT bill is harmless; a PENDING bill with
    // no SUBMITTED event would misattribute the submitter — event goes first.
    assert.deepEqual(order, ['event', 'status']);
    assert.equal((audit.log.mock.calls[0] as any).arguments[0].action, 'procurement.vendor_bill.submit');
  });

  it('blocks the maker from verifying their own tax evidence', async () => {
    const vatBill = bill({
      status: 'NEEDS_REVIEW',
      lines: [{ id: 'line_1', lineNumber: 1, vatAmount: '7.00', lineSubtotalAmount: '100', lineTotalAmount: '107', inputVatClaimStatus: 'NEEDS_REVIEW' }],
    });
    const repo: any = {
      findVendorBillById: mock.fn(async () => vatBill),
      getProcurementApprovalPolicy: mock.fn(async () => null),
      listPurchaseApprovalEvents: mock.fn(async () => []),
    };
    const useCase = new ReviewVendorBillTaxEvidenceUseCase(repo, { log: mock.fn(async () => undefined) } as any);
    await assert.rejects(
      () => useCase.execute({ companyId: 'co_1', userId: 'u_creator', permissions: ['procurement.vendor_bill.approve'] } as any, 'bill_1', 'VERIFIED'),
      (error: any) => {
        assert.ok(error instanceof ForbiddenException);
        assert.equal((error.getResponse() as any).code, 'vendor_bill_self_evidence_verify_blocked');
        return true;
      },
    );
  });

  it('lets an OWNER maker verify their own tax evidence (small-company exemption)', async () => {
    const vatBill = bill({
      status: 'NEEDS_REVIEW', taxInvoiceNumber: 'TAX-001', taxInvoiceDate: new Date('2026-07-10'), attachmentId: 'att_1',
      taxEvidenceRequired: true, taxEvidenceReviewStatus: 'REVIEW_REQUIRED', vatAmount: '7', inputVatClaimStatus: 'NEEDS_REVIEW',
      lines: [{ id: 'line_1', lineNumber: 1, vatAmount: '7', lineSubtotalAmount: '100', lineTotalAmount: '107', inputVatClaimStatus: 'NEEDS_REVIEW', taxSnapshot: { taxContext: 'DOMESTIC_PURCHASE' } }],
    });
    const repo: any = {
      findVendorBillById: mock.fn(async () => vatBill),
      getProcurementApprovalPolicy: mock.fn(async () => null),
      findSupplierById: mock.fn(async () => ({ id: 'sup_1', taxId: '0100000000001', vatRegistered: true })),
      isActiveVendorBillAttachment: mock.fn(async () => true),
      updateVendorBillTaxEvidenceState: mock.fn(async (_c: string, _i: string, data: any) => ({ ...vatBill, ...data })),
    };
    const useCase = new ReviewVendorBillTaxEvidenceUseCase(repo, { log: mock.fn(async () => undefined) } as any);
    const result = await useCase.execute({ companyId: 'co_1', userId: 'u_creator', roles: ['OWNER'], permissions: ['procurement.vendor_bill.approve'] } as any, 'bill_1', 'VERIFIED');
    assert.equal(result.taxEvidenceReviewStatus, 'VERIFIED');
  });

  it('recording a payment requires the separate release permission', async () => {
    const useCase = new CreateSupplierPaymentUseCase({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, { isSystemIssuanceOpen: async () => true } as any);
    const dto: any = { supplierId: 'sup_1', paymentDate: new Date(), method: 'BANK_TRANSFER', grossAmount: '100', netPaidAmount: '100', allocations: [] };
    await assert.rejects(
      () => useCase.execute({ companyId: 'co_1', userId: 'u1', permissions: ['procurement.supplier_payment.create'] } as any, dto),
      (error: any) => error instanceof ForbiddenException && /supplier_payment.release/.test(error.message),
    );
    await assert.rejects(
      () => useCase.execute({ companyId: 'co_1', userId: 'u1', permissions: ['procurement.supplier_payment.release'] } as any, dto),
      ForbiddenException,
    );
  });

  it('records the payment with an audit entry when create and release are both held', async () => {
    const approvedBill = bill({ status: 'APPROVED', branchId: 'branch-1' });
    const repo: any = {
      resolveCreateBranchId: async (_companyId: string, _scopes: unknown, branchId?: string) => branchId,
      branchExists: async () => true,
      findSupplierPaymentByIdempotencyKey: mock.fn(async () => null),
      findSupplierById: mock.fn(async () => ({ id: 'sup_1', status: 'ACTIVE' })),
      findVendorBillById: mock.fn(async () => approvedBill),
      createSupplierPayment: mock.fn(async () => ({ id: 'pay_1', status: 'RECORDED' })),
    };
    const audit = { log: mock.fn(async () => undefined) };
    const outbox = { append: mock.fn(async () => undefined) };
    const reserveNumber = { execute: mock.fn(async () => ({ id: 'num_1', documentNumber: 'PAY-1' })) };
    const commitNumber = { execute: mock.fn(async () => undefined) };
    const useCase = new CreateSupplierPaymentUseCase(repo, audit as any, outbox as any, reserveNumber as any, commitNumber as any, {} as any, { isSystemIssuanceOpen: async () => true } as any);
    const payment = await useCase.execute(
      { companyId: 'co_1', userId: 'u3', requestId: 'req_1', permissions: ['procurement.supplier_payment.create', 'procurement.supplier_payment.release'] } as any,
      { supplierId: 'sup_1', paymentDate: new Date('2026-07-10'), method: 'BANK_TRANSFER', grossAmount: '1500.00', netPaidAmount: '1500.00', allocations: [{ vendorBillId: 'bill_1', amount: '1500.00' }] },
    );
    assert.equal(payment.status, 'RECORDED');
    assert.equal((audit.log.mock.calls[0] as any).arguments[0].action, 'procurement.supplier_payment.create');
    assert.equal((outbox.append.mock.calls[0] as any).arguments[0], 'supplier_payment.recorded');
  });
});

describe('ProcurementApprovalPolicy use cases (H-07)', () => {
  it('returns fail-closed defaults when no policy row exists', async () => {
    const repo: any = { getProcurementApprovalPolicy: mock.fn(async () => null) };
    const policy = await new GetProcurementApprovalPolicyUseCase(repo).execute({ companyId: 'co_1', permissions: ['procurement.approval_policy.read'] } as any);
    assert.equal(policy.allowSelfApproval, false);
    assert.equal(policy.dualApprovalThresholdAmount, null);
  });

  it('requires read and manage permissions', async () => {
    const repo: any = { getProcurementApprovalPolicy: mock.fn(async () => null) };
    await assert.rejects(() => new GetProcurementApprovalPolicyUseCase(repo).execute({ companyId: 'co_1', permissions: [] } as any), ForbiddenException);
    const audit = { log: mock.fn(async () => undefined) };
    await assert.rejects(
      () => new UpdateProcurementApprovalPolicyUseCase(repo, audit as any).execute({ companyId: 'co_1', permissions: ['procurement.approval_policy.read'] } as any, { allowSelfApproval: true }),
      ForbiddenException,
    );
  });

  it('validates the threshold with the H-05 money grammar and audits changes as CRITICAL', async () => {
    const repo: any = {
      getProcurementApprovalPolicy: mock.fn(async () => null),
      upsertProcurementApprovalPolicy: mock.fn(async (_c: string, data: any) => ({ id: 'pol_1', companyId: 'co_1', allowSelfApproval: false, dualApprovalThresholdAmount: data.dualApprovalThresholdAmount, createdByUserId: 'u1', createdAt: new Date(), updatedAt: new Date() })),
    };
    const audit = { log: mock.fn(async () => undefined) };
    const ctx: any = { companyId: 'co_1', userId: 'u1', permissions: ['procurement.approval_policy.manage'] };
    const useCase = new UpdateProcurementApprovalPolicyUseCase(repo, audit as any);
    await assert.rejects(() => useCase.execute(ctx, { dualApprovalThresholdAmount: '-5' }), BadRequestException);
    await assert.rejects(() => useCase.execute(ctx, { dualApprovalThresholdAmount: '0' }), BadRequestException);
    await assert.rejects(() => useCase.execute(ctx, { dualApprovalThresholdAmount: 'abc' }), BadRequestException);
    await assert.rejects(() => useCase.execute(ctx, { dualApprovalThresholdAmount: '007' }), BadRequestException);
    const updated = await useCase.execute(ctx, { dualApprovalThresholdAmount: '50000' });
    assert.equal(updated.dualApprovalThresholdAmount, '50000.0000');
    const logged = (audit.log.mock.calls[0] as any).arguments[0];
    assert.equal(logged.riskLevel, 'CRITICAL');
    assert.equal(logged.action, 'procurement.approval_policy.update');
    // null disables dual approval again.
    const disabled = await useCase.execute(ctx, { dualApprovalThresholdAmount: null });
    assert.equal(disabled.dualApprovalThresholdAmount, null);
  });
});
