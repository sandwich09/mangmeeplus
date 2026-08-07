import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../../common/pipes/validation-pipe.options';
import {
  ApprovalNoteDto, CreateGoodsReceiptDto, CreatePurchaseOrderDto, CreatePurchaseRequestDto,
  CreateSupplierBankAccountDto, CreateSupplierDto, CreateSupplierPaymentDto, CreateVendorBillDto,
  MatchOverrideDto, RequiredNoteDto, RequiredReasonDto, ReviewVendorBillTaxEvidenceDto,
  UpdateApprovalPolicyDto, UpdateSupplierDto, UpdateVendorBillTaxEvidenceDto,
} from './procurement.dtos';

// The exact gate main.ts registers. The "accepts" cases below are copied from the
// real callers (apps/web/src/features/{procurement,accounts-payable}/*.api.ts and
// e2e/{procurement,accounts-payable}.spec.ts) — under forbidNonWhitelisted a DTO
// that is narrower than a live payload turns that page into a 400, so these are
// caller-compatibility tests first and validation tests second.
const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);

const accepts = (metatype: any, body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype });

async function rejects(metatype: any, body: Record<string, unknown>, label?: string) {
  await assert.rejects(
    () => pipe.transform(body, { type: 'body', metatype }),
    BadRequestException,
    label ?? `expected rejection for ${JSON.stringify(body)}`,
  );
}

describe('supplier DTOs', () => {
  // e2e/procurement.spec.ts createSupplier
  const valid = { displayName: 'E2E PO supplier', supplierType: 'JURISTIC_PERSON', defaultCurrency: 'THB' };

  it('accepts the payload e2e and apps/web send', async () => {
    const out = await accepts(CreateSupplierDto, valid);
    assert.equal(out.displayName, 'E2E PO supplier');
    assert.equal(out.supplierType, 'JURISTIC_PERSON');
  });

  it('rejects the UAT incident value supplierType "COMPANY" before it reaches Prisma', async () => {
    await rejects(CreateSupplierDto, { ...valid, supplierType: 'COMPANY' });
    await rejects(UpdateSupplierDto, { supplierType: 'COMPANY' });
  });

  it('rejects every other unknown enum value on the four Prisma enum columns', async () => {
    await rejects(CreateSupplierDto, { ...valid, defaultVatMode: 'VAT_7' });
    await rejects(CreateSupplierDto, { ...valid, defaultInputVatClaimStatus: 'YES' });
    await rejects(UpdateSupplierDto, { status: 'DELETED' });
  });

  it('rejects tenant and identity fields the caller must not set', async () => {
    for (const poison of [{ companyId: 'other-tenant' }, { id: 'sup_hijack' }, { counterpartyId: 'cp_1' }, { status: 'ACTIVE' }]) {
      await rejects(CreateSupplierDto, { ...valid, ...poison });
    }
  });

  it('requires a display name on create but not on update', async () => {
    await rejects(CreateSupplierDto, { supplierType: 'INDIVIDUAL' });
    const out = await accepts(UpdateSupplierDto, { phone: '021234567' });
    assert.equal(out.phone, '021234567');
  });

  it('keeps supplier bank accounts to the last 4 digits', async () => {
    const out = await accepts(CreateSupplierBankAccountDto, { bankName: 'KBank', accountName: 'ACME', accountNumberLast4: '1234', isDefault: true });
    assert.equal(out.accountNumberLast4, '1234');
    await rejects(CreateSupplierBankAccountDto, { bankName: 'KBank', accountName: 'ACME', accountNumberLast4: '1234567890' });
  });
});

describe('CreatePurchaseOrderDto', () => {
  // e2e/procurement.spec.ts createPurchaseOrder + serviceLine
  const valid = {
    supplierId: 'sup_1', orderDate: '2026-07-29T00:00:00.000Z', currency: 'THB', matchingMode: 'NONE',
    subtotalAmount: '100.00', discountAmount: '0.00', taxableAmount: '100.00', vatAmount: '0.00',
    grandTotalAmount: '100.00', outstandingAmount: '100.00',
    lines: [{
      lineNumber: 1, lineType: 'SERVICE', description: 'E2E PO line', unitName: 'each',
      orderedQuantity: '1', unitPrice: '100.00', discountAmount: '0.00', vatMode: 'NO_VAT',
      vatAmount: '0.00', lineSubtotalAmount: '100.00', lineTotalAmount: '100.00',
    }],
  };

  it('accepts the e2e payload and hands the use case a real Date', async () => {
    const out = await accepts(CreatePurchaseOrderDto, valid);
    assert.ok(out.orderDate instanceof Date, 'orderDate must be converted — the use cases type it as Date');
    assert.equal(out.orderDate.toISOString(), '2026-07-29T00:00:00.000Z');
    assert.equal(out.lines[0].lineType, 'SERVICE');
  });

  it('accepts a date-only orderDate the same way Prisma used to parse the raw string', async () => {
    const out = await accepts(CreatePurchaseOrderDto, { ...valid, orderDate: '2026-07-29' });
    assert.equal(out.orderDate.toISOString(), '2026-07-29T00:00:00.000Z');
  });

  it('rejects an unparseable date instead of forwarding Invalid Date', async () => {
    await rejects(CreatePurchaseOrderDto, { ...valid, orderDate: 'not-a-date' });
    await rejects(CreatePurchaseOrderDto, { ...valid, orderDate: '2026-02-30T99:00:00Z' });
  });

  it('rejects unknown enums and malformed decimal strings', async () => {
    await rejects(CreatePurchaseOrderDto, { ...valid, matchingMode: 'FOUR_WAY' });
    await rejects(CreatePurchaseOrderDto, { ...valid, lines: [{ ...valid.lines[0], vatMode: 'VAT_7' }] });
    await rejects(CreatePurchaseOrderDto, { ...valid, subtotalAmount: '1e5' });
    await rejects(CreatePurchaseOrderDto, { ...valid, subtotalAmount: 100 as unknown as string });
  });

  it('rejects status, numbering, and tenant fields the workflow owns', async () => {
    for (const poison of [{ companyId: 'other' }, { status: 'ISSUED' }, { purchaseOrderNumber: 'PO-1' }, { approvedByUserId: 'u1' }, { receivedAmount: '0.00' }]) {
      await rejects(CreatePurchaseOrderDto, { ...valid, ...poison });
    }
  });

  it('requires at least one line', async () => {
    await rejects(CreatePurchaseOrderDto, { ...valid, lines: [] });
  });
});

describe('CreatePurchaseRequestDto', () => {
  const valid = {
    currency: 'THB', subtotalAmount: '50.00', discountAmount: '0.00', taxableAmount: '50.00',
    vatAmount: '0.00', grandTotalAmount: '50.00',
    lines: [{
      lineNumber: 1, description: 'PR line', requestedQuantity: '1', estimatedUnitPrice: '50.00',
      discountAmount: '0.00', vatMode: 'NO_VAT', vatAmount: '0.00',
      lineSubtotalAmount: '50.00', lineTotalAmount: '50.00',
    }],
  };

  it('accepts a request without a supplier or needed-by date', async () => {
    const out = await accepts(CreatePurchaseRequestDto, valid);
    assert.equal(out.lines.length, 1);
    assert.equal(out.neededByDate, undefined);
  });

  it('converts neededByDate when present', async () => {
    const out = await accepts(CreatePurchaseRequestDto, { ...valid, neededByDate: '2026-08-01' });
    assert.ok(out.neededByDate instanceof Date);
  });

  it('rejects requester/status fields set by the caller', async () => {
    await rejects(CreatePurchaseRequestDto, { ...valid, requesterUserId: 'someone-else' });
    await rejects(CreatePurchaseRequestDto, { ...valid, status: 'APPROVED' });
  });
});

describe('CreateGoodsReceiptDto', () => {
  // e2e/procurement.spec.ts receiptLine
  const valid = {
    purchaseOrderId: 'po_1', supplierId: 'sup_1', receivedAt: '2026-07-29T03:00:00.000Z',
    lines: [{
      purchaseOrderLineId: 'pol_1', lineNumber: 1, lineType: 'STOCK', productId: 'prd_1',
      inventoryLocationId: 'loc_1', description: 'GR line', unitName: 'each',
      orderedQuantity: '10', previouslyReceivedQuantity: '0', receivedQuantity: '4',
      acceptedQuantity: '4', rejectedQuantity: '0',
    }],
  };

  it('accepts the e2e payload, including the zero quantities it really sends', async () => {
    const out = await accepts(CreateGoodsReceiptDto, valid);
    assert.equal(out.lines[0].rejectedQuantity, '0');
    assert.equal(out.lines[0].previouslyReceivedQuantity, '0');
    assert.ok(out.receivedAt instanceof Date);
  });

  it('rejects negative quantities and movement fields the post step owns', async () => {
    await rejects(CreateGoodsReceiptDto, { ...valid, lines: [{ ...valid.lines[0], receivedQuantity: '-4' }] });
    await rejects(CreateGoodsReceiptDto, { ...valid, lines: [{ ...valid.lines[0], inventoryMovementId: 'mov_1' }] });
    await rejects(CreateGoodsReceiptDto, { ...valid, status: 'POSTED' });
  });
});

describe('CreateVendorBillDto', () => {
  // apps/web AccountsPayablePages createVendorBill — note transactionContext on the line.
  const webPayload = {
    supplierId: 'sup_1', billDate: '2026-07-29', dueDate: '2026-08-05', currency: 'THB',
    vatMode: 'NO_VAT', matchingMode: 'NONE', pp36Candidate: false,
    lines: [{
      lineNumber: 1, description: 'บริการที่ปรึกษา', quantity: '1', unitPrice: '100',
      vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
      taxCodeDefinitionId: 'txd_1', externalTaxCode: 'I7', transactionContext: 'DOMESTIC_PURCHASE',
    }],
  };

  it('accepts the apps/web payload with transactionContext on the line', async () => {
    const out = await accepts(CreateVendorBillDto, webPayload);
    assert.equal(out.lines[0].transactionContext, 'DOMESTIC_PURCHASE');
    assert.equal(out.lines[0].externalTaxCode, 'I7');
  });

  it('gives the use case a Date for billDate — it calls .toISOString() on it whenever a line carries a tax code', async () => {
    const out = await accepts(CreateVendorBillDto, webPayload);
    assert.ok(out.billDate instanceof Date);
    assert.equal(out.billDate.toISOString(), '2026-07-29T00:00:00.000Z');
    assert.ok(out.dueDate instanceof Date);
  });

  it('accepts the e2e payload, which also sends header totals', async () => {
    const out = await accepts(CreateVendorBillDto, {
      supplierId: 'sup_1', billDate: '2026-07-29T00:00:00.000Z', dueDate: '2026-08-05T00:00:00.000Z',
      currency: 'THB', vatMode: 'NO_VAT', supplierDocumentNumber: 'E2E-BILL-1',
      subtotalAmount: '100.00', discountAmount: '0.00', taxableAmount: '100.00', vatAmount: '0.00',
      inputVatClaimStatus: 'NON_CLAIMABLE', whtAmount: '0.00', grandTotalAmount: '100.00',
      netPayableAmount: '100.00', matchingMode: 'NONE',
      lines: [{
        lineNumber: 1, lineType: 'SERVICE', description: 'E2E AP line', unitName: 'each',
        quantity: '1', unitPrice: '100.00', discountAmount: '0.00', vatMode: 'NO_VAT',
        vatAmount: '0.00', inputVatClaimStatus: 'NON_CLAIMABLE', whtAmount: '0.00',
        lineSubtotalAmount: '100.00', lineTotalAmount: '100.00',
      }],
    });
    assert.equal(out.supplierDocumentNumber, 'E2E-BILL-1');
  });

  it('accepts the PP36 import fields the tax path reads off the line', async () => {
    const out = await accepts(CreateVendorBillDto, {
      ...webPayload, pp36Candidate: true,
      lines: [{ ...webPayload.lines[0], transactionContext: 'IMPORT_SERVICE', evidenceRefs: ['ev_1'], authoritativeImportVatAmount: '7.00' }],
    });
    assert.deepEqual(out.lines[0].evidenceRefs, ['ev_1']);
    assert.equal(out.lines[0].authoritativeImportVatAmount, '7.00');
  });

  it('rejects unknown enums on the header and the line', async () => {
    await rejects(CreateVendorBillDto, { ...webPayload, vatMode: 'VAT_7' });
    await rejects(CreateVendorBillDto, { ...webPayload, lines: [{ ...webPayload.lines[0], inputVatClaimStatus: 'MAYBE' }] });
    await rejects(CreateVendorBillDto, { ...webPayload, lines: [{ ...webPayload.lines[0], transactionContext: 'DOMESTIC' }] });
  });

  it('rejects posting, matching, and approval state the workflow owns', async () => {
    for (const poison of [{ companyId: 'other' }, { status: 'APPROVED' }, { postingStatus: 'posted' }, { matchingStatus: 'MATCHED' }, { paidAmount: '100.00' }, { voidReason: 'x' }]) {
      await rejects(CreateVendorBillDto, { ...webPayload, ...poison });
    }
  });
});

describe('CreateSupplierPaymentDto', () => {
  // apps/web AccountsPayablePages createSupplierPayment
  const valid = {
    idempotencyKey: '2f1c0b8e-0000-4000-8000-000000000000', supplierId: 'sup_1',
    paymentDate: '2026-07-29', method: 'BANK_TRANSFER', currency: 'THB',
    grossAmount: '100.00', whtAmount: '0', netPaidAmount: '100.00', externalReference: 'REF-1',
    allocations: [{ vendorBillId: 'vb_1', amount: '100.00', pp36PaymentEvidenceIds: ['ev_1'] }],
  };

  it('accepts the apps/web payload', async () => {
    const out = await accepts(CreateSupplierPaymentDto, valid);
    assert.equal(out.method, 'BANK_TRANSFER');
    assert.ok(out.paymentDate instanceof Date);
    assert.deepEqual(out.allocations[0].pp36PaymentEvidenceIds, ['ev_1']);
  });

  it('rejects an unknown payment method and an empty allocation list', async () => {
    await rejects(CreateSupplierPaymentDto, { ...valid, method: 'PROMPTPAY' });
    await rejects(CreateSupplierPaymentDto, { ...valid, allocations: [] });
  });

  it('rejects status and posting fields', async () => {
    await rejects(CreateSupplierPaymentDto, { ...valid, status: 'RECORDED' });
    await rejects(CreateSupplierPaymentDto, { ...valid, postingStatus: 'posted' });
  });
});

describe('vendor bill workflow bodies', () => {
  it('accepts the empty body apps/web sends when approving without a note', async () => {
    const out = await accepts(ApprovalNoteDto, {});
    assert.equal(out.note, undefined);
  });

  it('requires a non-empty reason to void and a non-empty note to reject', async () => {
    assert.equal((await accepts(RequiredReasonDto, { reason: 'ยกเลิกตามคำสั่ง' })).reason, 'ยกเลิกตามคำสั่ง');
    await rejects(RequiredReasonDto, {});
    await rejects(RequiredReasonDto, { reason: '' });
    await rejects(RequiredNoteDto, { note: '' });
    await rejects(MatchOverrideDto, { overrideReason: '' });
  });

  it('limits the tax-evidence review to the two decisions the use case handles', async () => {
    assert.equal((await accepts(ReviewVendorBillTaxEvidenceDto, { status: 'VERIFIED' })).status, 'VERIFIED');
    await rejects(ReviewVendorBillTaxEvidenceDto, { status: 'DRAFT' });
    await rejects(ReviewVendorBillTaxEvidenceDto, { status: 'REVIEW_REQUIRED' });
  });

  it('converts the tax-evidence invoice date instead of building Invalid Date from a missing field', async () => {
    const out = await accepts(UpdateVendorBillTaxEvidenceDto, { taxInvoiceNumber: 'TI-1', taxInvoiceDate: '2026-07-20', attachmentId: 'att_1' });
    assert.ok(out.taxInvoiceDate instanceof Date);
    await rejects(UpdateVendorBillTaxEvidenceDto, { taxInvoiceNumber: 'TI-1', attachmentId: 'att_1' });
  });

  it('accepts the explicit null apps/web sends to disable the dual-approval threshold', async () => {
    const out = await accepts(UpdateApprovalPolicyDto, { allowSelfApproval: false, dualApprovalThresholdAmount: null });
    assert.equal(out.dualApprovalThresholdAmount, null);
    assert.equal((await accepts(UpdateApprovalPolicyDto, { dualApprovalThresholdAmount: '50000' })).dualApprovalThresholdAmount, '50000');
    await rejects(UpdateApprovalPolicyDto, { allowSelfApproval: 'yes' });
    await rejects(UpdateApprovalPolicyDto, { dualApprovalThresholdAmount: 'lots' });
  });
});
