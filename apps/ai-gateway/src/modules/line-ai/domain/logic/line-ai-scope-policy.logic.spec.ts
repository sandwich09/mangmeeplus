import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lineActionBoundaryReplyText, moduleFeatureEnabled, readOnlyCaptureReplyText, scopePolicyOverride, unsoldModuleReplyText, unsoldModuleTopicFor } from './line-ai-scope-policy.logic';

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

describe('item 2: LINE approve/reject/pay/confirm/void action boundary (spec §11)', () => {
  const APPROVER = ['reimbursement.approve', 'reimbursement.reject', 'reimbursement.payment.record'];
  const FINANCE = ['expense.confirm', 'expense.void'];

  it('approve reimbursement with permission: says do it on the web, never "ดึงข้อมูลไม่ได้"', () => {
    const text = lineActionBoundaryReplyText('ช่วยอนุมัติใบเบิกของสมชายให้หน่อยค่ะ', APPROVER, 'th')!;
    assert.ok(text, 'expected an override');
    assert.ok(text.includes('LINE ไม่ได้'), text);
    assert.ok(!text.includes('ดึงข้อมูล'), text);
  });

  it('approve reimbursement WITHOUT permission: names the role limit, not a data-fetch failure', () => {
    const text = lineActionBoundaryReplyText('ช่วยอนุมัติใบเบิกอันนี้ให้หน่อยค่ะ', ['reimbursement.read_own'], 'th')!;
    assert.ok(text.startsWith('บทบาทของคุณยังไม่มีสิทธิ์'), text);
  });

  it('reject a reimbursement claim', () => {
    const withPermission = lineActionBoundaryReplyText('ปฏิเสธใบเบิกนี้หน่อยค่ะ', APPROVER, 'th');
    const withoutPermission = lineActionBoundaryReplyText('ปฏิเสธใบเบิกนี้หน่อยค่ะ', [], 'th');
    assert.ok(withPermission?.includes('เว็บ'));
    assert.ok(withoutPermission?.startsWith('บทบาทของคุณยังไม่มีสิทธิ์'));
  });

  it('pay a reimbursement claim', () => {
    const text = lineActionBoundaryReplyText('ช่วยจ่ายใบเบิกให้หน่อยค่ะ', APPROVER, 'th')!;
    assert.ok(text.includes('LINE ไม่ได้'), text);
  });

  it('confirm an expense record', () => {
    const withPermission = lineActionBoundaryReplyText('ยืนยันรายการค่าใช้จ่ายนี้ให้หน่อยค่ะ', FINANCE, 'th');
    const withoutPermission = lineActionBoundaryReplyText('ยืนยันรายการค่าใช้จ่ายนี้ให้หน่อยค่ะ', [], 'th');
    assert.ok(withPermission?.includes('เว็บ'));
    assert.ok(withoutPermission?.startsWith('บทบาทของคุณยังไม่มีสิทธิ์'));
  });

  it('void a confirmed expense record', () => {
    const withPermission = lineActionBoundaryReplyText('ยกเลิกรายการค่าใช้จ่ายนี้หน่อยค่ะ', FINANCE, 'th');
    const withoutPermission = lineActionBoundaryReplyText('ยกเลิกรายการค่าใช้จ่ายนี้หน่อยค่ะ', [], 'th');
    assert.ok(withPermission?.includes('เว็บ'));
    assert.ok(withoutPermission?.startsWith('บทบาทของคุณยังไม่มีสิทธิ์'));
  });

  it('does not fire for an ordinary read question naming neither a claim nor an action verb', () => {
    assert.equal(lineActionBoundaryReplyText('ค่าใช้จ่ายเดือนนี้เท่าไหร่คะ', [], 'th'), undefined);
  });

  it('does not fire for an unrelated use of a bare action verb with no reimbursement/expense noun', () => {
    assert.equal(lineActionBoundaryReplyText('ยกเลิกการนัดหมายพรุ่งนี้ให้หน่อยค่ะ', [], 'th'), undefined);
  });

  it('does not fire for a STATUS QUESTION about a claim, only for a REQUEST to act on it (eval T-093-b)', () => {
    // "has my claim not been paid yet?" names ใบเบิก + จ่าย but asks, it does not request the action —
    // this belongs to item 4's routing guard (reimbursement.get_summary), never this override.
    assert.equal(lineActionBoundaryReplyText('ใบเบิกที่ฉันขอไปยังไม่จ่ายใช่ป่ะคะ', [], 'th'), undefined);
    assert.equal(lineActionBoundaryReplyText('ใบเบิกอนุมัติหรือยังคะ', [], 'th'), undefined);
  });

  it('does not fire for "รออนุมัติ" (pending approval, a STATE) with no request marker (whole-chain regression T-089)', () => {
    // "how many claims are pending approval this month?" — a plain count/read question routed to
    // reimbursement.list_pending_approvals; "รออนุมัติ" contains the bare verb "อนุมัติ" as a
    // substring but names a state, never a command, and the sentence carries no request marker.
    assert.equal(lineActionBoundaryReplyText('ใบเบิกรออนุมัติเดือนนี้มีกี่รายการครับ', [], 'th'), undefined);
  });
});

describe('item 3: a read-only role asking to record, upload, or capture (spec §8 "นอกสิทธิ์")', () => {
  // Real AUDITOR_READONLY grant (permission-registry.ts): read/export everywhere, no expense-create.
  const AUDITOR_READONLY_PERMISSIONS = ['expense.read', 'expense.read_related', 'expense.evidence.read', 'expense.read_own', 'expense.export', 'reimbursement.read', 'reimbursement.read_related', 'reimbursement.create'];

  it('blocks a capture request for a role with no expense-create permission', () => {
    const text = readOnlyCaptureReplyText('ถ่ายรูปใบเสร็จแล้วส่งเข้าระบบให้หน่อยค่ะ', AUDITOR_READONLY_PERMISSIONS, 'th')!;
    assert.ok(text.startsWith('บทบาทของคุณดูข้อมูลได้อย่างเดียวค่ะ'), text);
  });

  it('does not block the same request for a role that can create expenses', () => {
    const text = readOnlyCaptureReplyText('ถ่ายรูปใบเสร็จแล้วส่งเข้าระบบให้หน่อยค่ะ', ['expense.receipt.line_upload'], 'th');
    assert.equal(text, undefined);
  });

  it('does not block a plain read question for the read-only role', () => {
    assert.equal(readOnlyCaptureReplyText('ค่าใช้จ่ายเดือนนี้เท่าไหร่คะ', AUDITOR_READONLY_PERMISSIONS, 'th'), undefined);
  });

  it('a read-only role keeping its own reimbursement self-service create is unaffected (different action)', () => {
    // AUDITOR_READONLY has reimbursement.create; asking to submit a reimbursement claim is not an
    // expense-capture request and must not be blocked by this check.
    assert.equal(readOnlyCaptureReplyText('ขอสร้างใบเบิกใหม่ค่ะ', AUDITOR_READONLY_PERMISSIONS, 'th'), undefined);
  });

  it('never blocks creating a REIMBURSEMENT draft, even without expense-create permission (whole-chain regression)', () => {
    // "create a draft to reimburse travel expenses" — "สร้างร่าง" alone is ambiguous between an
    // expense capture and a reimbursement draft; this check only ever gates the expense-capture
    // reading, so it must stay silent here regardless of permissions.
    assert.equal(readOnlyCaptureReplyText('สร้างร่างเบิกค่าเดินทาง', [], 'th'), undefined);
    assert.equal(readOnlyCaptureReplyText('สร้างร่างเบิกค่าเดินทาง', ['reimbursement.create'], 'th'), undefined);
  });
});

describe('scopePolicyOverride: combined entry point and kind exemption', () => {
  it('exempts the unsold-module check for kind "help" (a real product-help gap answers its own way)', () => {
    assert.equal(scopePolicyOverride('ถ่ายใบเสร็จยังไงคะ ยอดขายเดือนนี้ดูตรงไหน', 'help', [], undefined, 'th'), undefined);
  });

  it('never exempts the LINE action boundary for kind "help"', () => {
    const override = scopePolicyOverride('อนุมัติใบเบิกทำยังไงคะ ช่วยอนุมัติให้เลยได้ไหม', 'help', [], undefined, 'th');
    assert.equal(override?.reasonCode, 'LINE_ACTION_NOT_SUPPORTED');
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
