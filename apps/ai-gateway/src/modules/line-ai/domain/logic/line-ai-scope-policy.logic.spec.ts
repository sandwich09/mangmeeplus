import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { moduleFeatureEnabled, scopePolicyOverride, unsoldModuleReplyText, unsoldModuleTopicFor } from './line-ai-scope-policy.logic';

describe('item 1: unsold module topic classifier (spec §2/§3 row 17)', () => {
  const CASES: Array<{ name: string; text: string; featureKey: string | null }> = [
    { name: 'sales/revenue', text: 'ขอดูยอดขายเดือนนี้หน่อยจ้ะ', featureKey: 'sales_documents' },
    { name: 'revenue synonym', text: 'เดือนนี้รายได้เท่าไหร่คะ', featureKey: 'sales_documents' },
    { name: 'P&L/profit', text: 'ขอรายงานกำไรขาดทุนเดือนนี้หน่อยค่ะ', featureKey: 'reports' },
    { name: 'receivables/customers', text: 'ดูลูกค้าที่ค้างชำระให้หน่อยคับ', featureKey: 'sales_documents' },
    { name: 'receivables synonym', text: 'ลูกหนี้เรามีใครค้างบ้าง', featureKey: 'sales_documents' },
    { name: 'invoice issuing', text: 'ช่วยออกใบแจ้งหนี้ให้ลูกค้าหน่อยครับ', featureKey: 'sales_documents' },
    { name: 'quotation', text: 'ขอใบเสนอราคาลูกค้าหน่อยค่ะ', featureKey: 'sales_documents' },
    { name: 'tax invoice as issuing', text: 'ช่วยออกใบกำกับภาษีให้ลูกค้าหน่อยค่ะ', featureKey: 'sales_documents' },
    { name: 'inventory/stock', text: 'เช็ค stock สินค้าคงเหลือให้หน่อยครับ', featureKey: 'inventory' },
    { name: 'stock Thai synonym', text: 'สต็อกคงเหลือตอนนี้เท่าไหร่คะ', featureKey: 'inventory' },
    { name: 'payroll', text: 'คำนวณเงินเดือนพนักงานให้หน่อยครับ', featureKey: null },
    { name: 'bank balance', text: 'เช็คยอดคงเหลือบัญชีธนาคารหน่อยค่ะ', featureKey: 'bank_reconciliation' },
    { name: 'bank reconciliation', text: 'ช่วยกระทบยอดบัญชีให้หน่อยค่ะ', featureKey: 'bank_reconciliation' },
    { name: 'purchase order', text: 'ขอดูใบสั่งซื้อค้างอยู่กี่ใบคะ', featureKey: 'procurement' },
  ];

  for (const { name, text, featureKey } of CASES) {
    it(`classifies ${name} ("${text}")`, () => {
      const topic = unsoldModuleTopicFor(text);
      assert.ok(topic, `expected a topic match for: ${text}`);
      assert.equal(topic!.featureKey, featureKey);
      assert.ok(topic!.topicLabelTh.length > 0);
    });
  }

  it('never flags "ใบกำกับ" mentioned only as expense evidence, without an issuing verb', () => {
    assert.equal(unsoldModuleTopicFor('ใบกำกับภาษีค่าน้ำมันอันนี้บันทึกหรือยังคะ'), undefined);
  });

  it('does not classify an ordinary expense question as any unsold topic', () => {
    assert.equal(unsoldModuleTopicFor('ค่าใช้จ่ายเดือนนี้เท่าไหร่คะ'), undefined);
  });

  it('mixed message: still finds the unsold clause when an expense clause is also present', () => {
    const topic = unsoldModuleTopicFor('ขอดูยอดขายเดือนนี้ กับค่าใช้จ่ายเดือนนี้ด้วยค่ะ');
    assert.equal(topic?.featureKey, 'sales_documents');
  });
});

describe('item 1: moduleFeatureEnabled fail-open/entitlement convention', () => {
  it('a null featureKey (payroll) is never enabled, even with entitledFeatureKeys absent', () => {
    assert.equal(moduleFeatureEnabled(null, undefined), false);
    assert.equal(moduleFeatureEnabled(null, ['sales_documents']), false);
  });

  it('absent entitledFeatureKeys fails open (legacy/older-caller convention)', () => {
    assert.equal(moduleFeatureEnabled('sales_documents', undefined), true);
  });

  it('explicit null entitledFeatureKeys fails open (legacy no-entitlement-rows company)', () => {
    assert.equal(moduleFeatureEnabled('sales_documents', null), true);
  });

  it('blocks when the company entitlement list does not include the feature', () => {
    assert.equal(moduleFeatureEnabled('sales_documents', ['expenses', 'reimbursement']), false);
  });

  it('does not block when the company entitlement list DOES include the feature', () => {
    assert.equal(moduleFeatureEnabled('sales_documents', ['expenses', 'reimbursement', 'sales_documents']), true);
  });

  it('produces the spec §8 copy naming the exact topic, plus two example questions', () => {
    const topic = unsoldModuleTopicFor('ขอดูยอดขายเดือนนี้หน่อยจ้ะ')!;
    const text = unsoldModuleReplyText(topic, 'th');
    assert.ok(text.includes('แพ็กเกจที่ใช้อยู่ยังไม่มีเรื่อง'), text);
    assert.ok(text.includes(topic.topicLabelTh), text);
    assert.ok(text.includes('รายจ่าย'), text);
    assert.equal((text.match(/"/g) ?? []).length, 4, 'expects exactly two quoted example questions');
  });

  it('produces an English reply naming the topic when the turn is in English', () => {
    const topic = unsoldModuleTopicFor('inventory stock check please')!;
    const text = unsoldModuleReplyText(topic, 'en');
    assert.ok(text.includes(topic.topicLabelEn), text);
  });
});

describe('scopePolicyOverride: combined entry point and kind exemption', () => {
  it('exempts the unsold-module check for kind "help" (a real product-help gap answers its own way)', () => {
    assert.equal(scopePolicyOverride('ถ่ายใบเสร็จยังไงคะ ยอดขายเดือนนี้ดูตรงไหน', 'help', [], undefined, 'th'), undefined);
  });

  it('applies the unsold-module check for kind "read" or "general"', () => {
    const asRead = scopePolicyOverride('ขอดูยอดขายเดือนนี้หน่อยจ้ะ', 'read', [], ['expenses'], 'th');
    const asGeneral = scopePolicyOverride('ขอดูยอดขายเดือนนี้หน่อยจ้ะ', 'general', [], ['expenses'], 'th');
    assert.equal(asRead?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.equal(asGeneral?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
  });

  it('a company with the feature entitled is never blocked', () => {
    const override = scopePolicyOverride('ขอดูยอดขายเดือนนี้หน่อยจ้ะ', 'read', [], ['expenses', 'sales_documents'], 'th');
    assert.equal(override, undefined);
  });
});
