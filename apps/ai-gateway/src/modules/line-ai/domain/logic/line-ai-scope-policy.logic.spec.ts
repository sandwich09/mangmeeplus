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
    // R2: purchase-order wording extension.
    { name: 'procurement department (จัดซื้อ)', text: 'ฝ่ายจัดซื้อขอดูสถานะการสั่งของหน่อยครับ', featureKey: 'procurement' },
    { name: 'สั่งซื้อ paired with ซัพพลายเออร์', text: 'สั่งซื้อวัตถุดิบจากซัพพลายเออร์รายใหม่ยังไงคะ', featureKey: 'procurement' },
    { name: 'สั่งซื้อ paired with ผู้ขาย', text: 'อยากสั่งซื้อสินค้าจากผู้ขายเจ้าประจำเพิ่มอีกค่ะ', featureKey: 'procurement' },
    { name: 'PO abbreviation', text: 'ขอเช็คสถานะ PO เลขที่ 1024 หน่อยครับ', featureKey: 'procurement' },
    { name: 'purchase order (English)', text: 'เช็ค purchase order เลขที่ 1024 ให้หน่อยค่ะ', featureKey: 'procurement' },
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

  // R2: plain purchase wording (no supplier/vendor word, no PO/จัดซื้อ/ใบสั่งซื้อ) stays an ordinary
  // expense question, never the out-of-package procurement reply.
  for (const text of [
    'ซื้อวัตถุดิบเข้าร้านวันนี้ค่ะ',
    'ค่าซื้อเครื่องดื่มสำหรับลูกค้า',
    'ซื้อแก๊สหุงต้มมาเติมค่ะ',
    'จ่ายค่าซื้ออุปกรณ์ทำความสะอาด',
  ]) {
    it(`never flags plain purchase wording as procurement ("${text}")`, () => {
      assert.equal(unsoldModuleTopicFor(text), undefined);
    });
  }

  it('never flags a bare "สั่งซื้อ" with no supplier/vendor word (still ordinary shopping)', () => {
    assert.equal(unsoldModuleTopicFor('สั่งซื้อกาแฟเจ้าประจำเหมือนเดิมค่ะ'), undefined);
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

  it('does not fire for a STATE phrase even WITH a request marker on the read verb (C2, T-084-b)', () => {
    // "เช็ค...หน่อยครับ" ("please check...") carries a request marker, but it requests a CHECK, not
    // an approval — "รออนุมัติ"/"จ่ายแล้ว" here name the claim's state, not a command.
    assert.equal(lineActionBoundaryReplyText('เช็คใบเบิกที่รออนุมัติหน่อยครับ', [], 'th'), undefined);
    assert.equal(lineActionBoundaryReplyText('รบกวนเช็คใบเบิกที่รออนุมัติอยู่ด้วยค่ะ', [], 'th'), undefined);
    assert.equal(lineActionBoundaryReplyText('ขอดูใบเบิกที่จ่ายแล้วหน่อย', [], 'th'), undefined);
  });

  it('still fires when a real action verb accompanies the state phrase (C2)', () => {
    const text = lineActionBoundaryReplyText('ช่วยอนุมัติใบเบิกที่รออนุมัติหน่อย', APPROVER, 'th')!;
    assert.ok(text.includes('LINE ไม่ได้'), text);
  });
});

describe('item 3: a read-only role asking to record, upload, or capture (spec §8 "นอกสิทธิ์")', () => {
  // Real AUDITOR_READONLY grant (permission-registry.ts): read/export everywhere, no expense-create.
  const AUDITOR_READONLY_PERMISSIONS = ['expense.read', 'expense.read_related', 'expense.evidence.read', 'expense.read_own', 'expense.export', 'reimbursement.read', 'reimbursement.read_related', 'reimbursement.create'];

  it('blocks a capture request for a role with no expense-create permission', () => {
    const text = readOnlyCaptureReplyText('ถ่ายรูปใบเสร็จแล้วส่งเข้าระบบให้หน่อยค่ะ', AUDITOR_READONLY_PERMISSIONS, 'th')!;
    // F4 (tuning-6b, T-145-a): customers and the eval look for "ไม่มีสิทธิ์"/"อ่านอย่างเดียว" plus a next
    // step — the old text ("ดูข้อมูลได้อย่างเดียว... ไม่สามารถ...") had neither.
    assert.ok(text.includes('อ่านอย่างเดียว'), text);
    assert.ok(text.includes('ไม่มีสิทธิ์'), text);
    assert.ok(text.includes('ผู้ดูแลบริษัท'), text);
  });

  it('states the same read-only boundary and next step in English', () => {
    const text = readOnlyCaptureReplyText('ถ่ายรูปใบเสร็จแล้วส่งเข้าระบบให้หน่อยค่ะ', AUDITOR_READONLY_PERMISSIONS, 'en')!;
    assert.ok(text.includes('read-only'), text);
    assert.ok(text.includes('admin'), text);
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

  it('applies the unsold-module check for kind "read" and "write"', () => {
    const asRead = scopePolicyOverride('ขอดูยอดขายเดือนนี้หน่อยจ้ะ', 'read', [], ['expenses'], 'th');
    const asWrite = scopePolicyOverride('ช่วยออกใบแจ้งหนี้ให้ลูกค้าหน่อยครับ', 'write', [], ['expenses'], 'th');
    assert.equal(asRead?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.equal(asWrite?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
  });

  // Owner 2026-09-29: general business knowledge is never blocked by the shop's package (payroll has no
  // feature at all, so "เงินเดือน…" was blocked for every shop).
  it('never applies the unsold-module check to kind "general"', () => {
    for (const text of ['รายได้เท่าไหร่ต้องจด VAT', 'กำไรขั้นต้นคืออะไร', 'เงินเดือนหักประกันสังคมกี่เปอร์เซ็นต์']) {
      assert.equal(scopePolicyOverride(text, 'general', [], ['expenses'], 'th'), undefined, text);
    }
  });

  it('still applies the LINE action boundary to kind "general"', () => {
    const override = scopePolicyOverride('ช่วยอนุมัติใบเบิกของสมชายให้หน่อยค่ะ', 'general', [], ['expenses'], 'th');
    assert.equal(override?.reasonCode, 'LINE_ACTION_NOT_SUPPORTED');
  });

  it('a company with the feature entitled is never blocked', () => {
    const override = scopePolicyOverride('ขอดูยอดขายเดือนนี้หน่อยจ้ะ', 'read', [], ['expenses', 'sales_documents'], 'th');
    assert.equal(override, undefined);
  });
});

// Advisor S1 (spec §2.6, §4.3 S3): signing or approving a substitute receipt stays on the web.
describe('advisor S1: signing or approving a substitute receipt from LINE', () => {
  const PAYER = ['expense.read_own', 'expense.read_related'];
  const APPROVER = [...PAYER, 'expense.confirm'];

  it('a sign request — with or without naming the document — says why it is web-only and links the page', () => {
    for (const text of ['เซ็นให้หน่อย', 'ช่วยเซ็นใบรับรองแทนใบเสร็จให้หน่อยค่ะ', 'ช่วยลงนามใบรับรองนี้หน่อย', 'ช่วยรับรองใบรับรองให้หน่อยนะ']) {
      const override = scopePolicyOverride(text, 'write', PAYER, ['expenses'], 'th');
      assert.equal(override?.reasonCode, 'LINE_ACTION_NOT_SUPPORTED', text);
      assert.ok(override!.text.includes('ลงลายมือชื่อใบรับรองแทนใบเสร็จทำผ่าน LINE ไม่ได้'), override!.text);
      assert.ok(override!.text.includes('ก่อนเซ็น'), 'gives the reason, not just the rule');
      assert.ok(override!.text.includes('หน้าใบรับรองแทนใบเสร็จบนเว็บ'), override!.text);
      assert.equal(override!.webPage, 'substitute-receipts', text);
    }
  });

  it('an approve request needs expense.confirm; without it the role limit is named and no link is offered', () => {
    const approver = scopePolicyOverride('ช่วยอนุมัติใบรับรองนี้ให้หน่อย', 'write', APPROVER, ['expenses'], 'th');
    assert.ok(approver!.text.startsWith('การอนุมัติใบรับรองแทนใบเสร็จทำผ่าน LINE ไม่ได้'), approver!.text);
    assert.equal(approver!.webPage, 'substitute-receipts');
    const staff = scopePolicyOverride('ช่วยอนุมัติใบรับรองนี้ให้หน่อย', 'write', PAYER, ['expenses'], 'th');
    assert.ok(staff!.text.startsWith('บทบาทของคุณยังไม่มีสิทธิ์อนุมัติใบรับรองแทนใบเสร็จ'), staff!.text);
    assert.equal(staff!.webPage, undefined);
  });

  it('a question about the queue — even with a request marker — is never read as a command', () => {
    for (const text of [
      'ใบรับรองใบเสร็จกี่ใบที่ฉันต้องเซ็น', 'มีใบรับรองแทนใบเสร็จรอฉันเซ็นกี่ใบ', 'มีใบรับรองรอฉันอนุมัติไหม',
      'ช่วยดูหน่อยว่ามีใบรับรองที่ต้องเซ็นไหม', 'ช่วยบอกหน่อยว่าใบรับรองรอเซ็นกี่ใบ', 'ช่วยดูใบรับรองที่รอฉันอนุมัติหน่อย',
      'ขอดูใบรับรองที่รอลงนามหน่อย', 'ช่วยอธิบายหน่อยว่าใบรับรองแทนใบเสร็จคืออะไร',
    ]) assert.equal(scopePolicyOverride(text, 'read', APPROVER, ['expenses'], 'th'), undefined, text);
  });

  it('never fires for a saved-signature request, signing in, or a claim/expense sentence', () => {
    for (const text of ['ช่วยส่งลายเซ็นให้หน่อย', 'ช่วยอัปโหลดลายเซ็นหน่อยค่ะ', 'ช่วยบอกวิธีลงชื่อเข้าใช้หน่อย']) {
      assert.equal(lineActionBoundaryReplyText(text, APPROVER, 'th'), undefined, text);
    }
    // A signing word beside a claim is the claim's own rule (or none) — never the substitute page.
    assert.equal(scopePolicyOverride('ช่วยเซ็นอนุมัติใบเบิกให้หน่อย', 'write', ['reimbursement.approve'], ['expenses'], 'th')?.webPage, undefined);
    assert.equal(scopePolicyOverride('ช่วยเซ็นใบเบิกให้หน่อย', 'write', APPROVER, ['expenses'], 'th'), undefined);
  });
});
