import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CrmCustomerSummary } from '@watchdog-bms/contracts';
import {
  CONSENT_STATUS_LABEL,
  CUSTOMER_STATUS_META,
  CUSTOMER_TYPE_LABEL,
  customerStatusParam,
  customerDuplicateErrorState,
  displayValue,
  findCustomerDuplicateMatches,
  normalizeCustomerPhone,
  lineIdentityText,
  validateCustomerForm,
} from './customers-prototype.model';

describe('customers prototype model', () => {
  it('maps customer status filters to API params', () => {
    assert.equal(customerStatusParam('all'), undefined);
    assert.equal(customerStatusParam('ACTIVE'), 'ACTIVE');
    assert.equal(customerStatusParam('ARCHIVED'), 'ARCHIVED');
  });

  it('keeps Thai labels for real customer fields', () => {
    assert.equal(CUSTOMER_STATUS_META.ACTIVE.label, 'ใช้งาน');
    assert.equal(CUSTOMER_TYPE_LABEL.ORGANIZATION, 'องค์กร');
    assert.equal(CONSENT_STATUS_LABEL.GRANTED, 'ยินยอม');
  });

  it('renders missing optional values as an em dash', () => {
    assert.equal(displayValue('089-555-0000'), '089-555-0000');
    assert.equal(displayValue('  '), '—');
    assert.equal(displayValue(undefined), '—');
  });

  it('normalizes phone and validates the minimal create form', () => {
    assert.equal(normalizeCustomerPhone('081-234 5678'), '812345678');
    assert.equal(normalizeCustomerPhone('+66 81 234 5678'), '812345678');
    assert.equal(normalizeCustomerPhone('0066 81 234 5678'), '812345678');
    assert.deepEqual(validateCustomerForm({ displayName: ' ', primaryPhone: '123' }), {
      displayName: 'กรุณากรอกชื่อลูกค้า',
      primaryPhone: 'เบอร์โทรต้องมี 8–15 หลัก',
    });
    assert.deepEqual(validateCustomerForm({ displayName: 'สมชาย', primaryPhone: '' }), {});
  });

  it('ranks exact phone over exact name and ignores archived records', () => {
    const base = {
      companyId: 'co-1', branchId: undefined, customerType: 'PERSON', ownerUserId: undefined,
      primaryEmail: undefined, taxId: undefined, consentStatus: 'UNKNOWN', tier: 'LEAD',
      originSource: 'MANUAL', createdByType: 'USER', lineIdentityCount: 0, hasVerifiedLineIdentity: false,
      engagementScore: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    } as const;
    const rows = [
      { ...base, id: 'phone', displayName: 'คนละชื่อ', primaryPhone: '081-234-5678', status: 'ACTIVE' },
      { ...base, id: 'name', displayName: 'สมชาย ใจดี', primaryPhone: '099', status: 'ACTIVE' },
      { ...base, id: 'old', displayName: 'สมชาย ใจดี', primaryPhone: '0812345678', status: 'ARCHIVED' },
    ] as CrmCustomerSummary[];
    assert.deepEqual(
      findCustomerDuplicateMatches(rows, { displayName: 'สมชาย   ใจดี', primaryPhone: '0812345678' })
        .map((match) => [match.customer.id, match.matchType]),
      [['phone', 'PHONE'], ['name', 'NAME']],
    );
  });

  it('renders only masked LINE identity data', () => {
    assert.equal(lineIdentityText([], 'ยังไม่เชื่อม LINE'), 'ยังไม่เชื่อม LINE');
    assert.equal(lineIdentityText([{ id: 'i1', channelId: 'ch', provider: 'LINE_OA', maskedProviderUserId: 'U12••••90', status: 'ACTIVE', verifiedLinkAt: '2026-01-01' }], 'none'), 'LINE U12••••90 · เชื่อมแล้ว · ยืนยันแล้ว');
  });

  it('keeps readable duplicate candidates but redacts manager-only lead conversion conflicts', () => {
    const warning = { customerId: 'c-1', displayName: 'สมชาย', status: 'ACTIVE', matchType: 'PHONE', confidence: 'HIGH' } as const;
    assert.deepEqual(customerDuplicateErrorState({ code: 'duplicate_customer_candidate', details: { warnings: [warning] } }), {
      restricted: false, warnings: [warning],
    });
    assert.deepEqual(customerDuplicateErrorState({ code: 'duplicate_candidate_requires_manager_review', details: { warnings: [{ ...warning, customerId: 'REDACTED' }] } }), {
      restricted: true, warnings: [],
    });
    assert.deepEqual(customerDuplicateErrorState({ code: 'duplicate_customer_candidate', details: {} }), {
      restricted: true, warnings: [],
    });
  });
});
