import { BILLING_PAID_TIERS as testPaidTiers, billingOffer as testBillingOffer } from '@watchdog-bms/contracts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_ACTION_RULES, lineActionBoundaryReplyText, moduleFeatureEnabled, readOnlyCaptureReplyText, scopePolicyOverride, unsoldModuleReplyText, unsoldModuleTopicFor } from './line-ai-scope-policy.logic';

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

  it('PWS-PLAIN-UNSOLD-REFUSAL offers the main menu without unsold topic jargon', () => {
    const topic = unsoldModuleTopicFor('ขอดูยอดขายเดือนนี้หน่อยจ้ะ')!;
    const text = unsoldModuleReplyText(topic, 'th');
    assert.equal(text, 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ');
    assert.equal(unsoldModuleReplyText(topic, 'en'), 'This task is unavailable here, type ‘เมนูหลัก’ to see the work you can use.');
    assert.ok(!text.includes(topic.topicLabelTh));
    assert.doesNotMatch(text, /อัปเกรด|บาท|\n/);
  });

  it('produces an English menu exit when the turn is in English', () => {
    const topic = unsoldModuleTopicFor('inventory stock check please')!;
    const text = unsoldModuleReplyText(topic, 'en');
    assert.equal(text, 'This task is unavailable here, type ‘เมนูหลัก’ to see the work you can use.');
  });
});

describe('Fix-up 17A: LINE_ACTION_RULES × permission', () => {
  for (const rule of LINE_ACTION_RULES) for (const granted of [false, true]) {
    const text = `ช่วย${rule.verb[0]}${rule.noun[0] ?? ''}ให้หน่อย`;
    it(`${rule.actionLabelTh} permission=${granted}: ${rule.page === 'substitute-receipts' ? 'web boundary' : 'existing use-case decides'}`, () => {
      const reply = lineActionBoundaryReplyText(text, granted ? [rule.permission] : [], 'th');
      if (rule.page !== 'substitute-receipts' && granted) assert.equal(reply, undefined);
      else assert.match(reply!, granted ? /เว็บ/ : /ไม่มีสิทธิ์/);
    });
  }
  for (const text of ['ใบเบิกรออนุมัติเดือนนี้มีกี่รายการ', 'เช็คใบเบิกที่รออนุมัติหน่อย', 'ใบเบิกที่ฉันขอไปยังไม่จ่ายใช่ป่ะคะ', 'ค่าใช้จ่ายเดือนนี้เท่าไหร่', 'สรุปใบเบิกแยกตามผู้อนุมัติหน่อย']) {
    it(`keeps status/read questions: ${text}`, () => assert.equal(lineActionBoundaryReplyText(text, [], 'th'), undefined));
  }
  for (const text of ['เปลี่ยนผู้อนุมัติใบเบิกที่ค้างอยู่', 'ตั้งค่าการอนุมัติใบเบิกยังไง', 'ตั้งให้ผู้จัดการอนุมัติใบเบิกได้', 'ใครอนุมัติใบเบิก', 'ทำให้หน่อย ให้ผู้จัดการอนุมัติใบเบิกได้ด้วย ไม่ต้องรอฉันคนเดียว']) {
    it(`approval settings: ${text}`, () => {
      assert.equal(lineActionBoundaryReplyText(text, ['reimbursement.approve'], 'th'), undefined);
      assert.equal(scopePolicyOverride(text, 'write', ['reimbursement.policy.manage'], ['expenses'], 'th')?.webPage, 'approval-settings');
      assert.equal(scopePolicyOverride(text, 'write', [], ['expenses'], 'th')?.webPage, 'packages');
    });
  }
});

describe('item 3: a read-only role asking to record, upload, or capture (spec §8 "นอกสิทธิ์")', () => {
  // Real AUDITOR_READONLY grant (permission-registry.ts): read/export everywhere, no expense-create.
  const AUDITOR_READONLY_PERMISSIONS = ['expense.read', 'expense.read_related', 'expense.evidence.read', 'expense.read_own', 'expense.export', 'reimbursement.read', 'reimbursement.read_related', 'reimbursement.create'];

  it('blocks a capture request for a role with no expense-create permission', () => {
    const text = readOnlyCaptureReplyText('ถ่ายรูปใบเสร็จแล้วส่งเข้าระบบให้หน่อยค่ะ', AUDITOR_READONLY_PERMISSIONS, 'th')!;
    // F4 (tuning-6b, T-145-a): customers and the eval look for "ไม่มีสิทธิ์"/"อ่านอย่างเดียว" plus a next
    // step — the old text ("ดูข้อมูลได้อย่างเดียว... ไม่สามารถ...") had neither.
    assert.ok(text.includes('ไม่มีสิทธิ์'), text);
    assert.ok(text.includes('ไม่มีสิทธิ์'), text);
    assert.ok(text.includes('เจ้าของกิจการ'), text);
  });

  it('states the same read-only boundary and next step in English', () => {
    const text = readOnlyCaptureReplyText('ถ่ายรูปใบเสร็จแล้วส่งเข้าระบบให้หน่อยค่ะ', AUDITOR_READONLY_PERMISSIONS, 'en')!;
    assert.ok(text.includes('cannot record'), text);
    assert.ok(text.includes('shop owner'), text);
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
    assert.match(override!.text, /ไม่มีสิทธิ์อนุมัติใบเบิก.*เจ้าของกิจการ/u);
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
    assert.match(override!.text, /ไม่มีสิทธิ์อนุมัติใบเบิก.*เจ้าของกิจการ/u);
  });

  it('a company with the feature entitled is never blocked', () => {
    const override = scopePolicyOverride('ขอดูยอดขายเดือนนี้หน่อยจ้ะ', 'read', [], ['expenses', 'sales_documents'], 'th');
    assert.equal(override, undefined);
  });

  // Advisor S2a (owner 2026-09-30 ~16:00; eval r5 P-31): "กำไรต่อแพ็กเกจ" routed to the package catalog is
  // about MangmeePlus's own packages, not this shop's P&L — the catalog answer, not the unsold-module line.
  it('a package question routed to a package read is not an unsold-module question', () => {
    const text = 'มั่งมีมีต้นทุน AI ต่อใบเสร็จเท่าไหร่ กำไรต่อแพ็กเกจเท่าไหร่';
    assert.equal(scopePolicyOverride(text, 'read', [], ['expenses'], 'th', 'billing.get_package_catalog'), undefined);
    assert.equal(scopePolicyOverride('ร้านรายได้ 1 ล้านใช้แพคเกจไหนได้บ้าง', 'read', [], ['expenses'], 'th', 'billing.get_package_catalog'), undefined);
    // The hint alone never lifts the reply: the clause must name a package or MangmeePlus, and any other hint keeps it.
    assert.equal(scopePolicyOverride('กำไรเดือนนี้เท่าไหร่', 'read', [], ['expenses'], 'th', 'billing.get_package_catalog')?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.equal(scopePolicyOverride(text, 'read', [], ['expenses'], 'th', 'expense.list_recent')?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
    assert.equal(scopePolicyOverride(text, 'read', [], ['expenses'], 'th')?.reasonCode, 'PACKAGE_FEATURE_NOT_ENABLED');
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

  it('a bare imperative that opens with the verb is a request even without a politeness marker', () => {
    for (const text of ['อนุมัติใบรับรองนี้เลย', 'เซ็นใบรับรองแทนใบเสร็จอันนี้เลย']) {
      assert.equal(scopePolicyOverride(text, 'write', APPROVER, ['expenses'], 'th')?.webPage, 'substitute-receipts', text);
    }
    // Claims and expenses keep their request-marker rule unchanged.
    assert.equal(lineActionBoundaryReplyText('อนุมัติใบเบิกนี้เลย', ['reimbursement.approve'], 'th'), undefined);
    // A statement that does not open with the verb is still no command.
    assert.equal(scopePolicyOverride('ใบรับรองของฉันอนุมัติแล้วหรือยัง', 'read', APPROVER, ['expenses'], 'th'), undefined);
  });

  it('an approve request needs expense.confirm; without it the role limit is named and an allowed alternative is linked', () => {
    const approver = scopePolicyOverride('ช่วยอนุมัติใบรับรองนี้ให้หน่อย', 'write', APPROVER, ['expenses'], 'th');
    assert.ok(approver!.text.startsWith('การอนุมัติใบรับรองแทนใบเสร็จทำผ่าน LINE ไม่ได้'), approver!.text);
    assert.equal(approver!.webPage, 'substitute-receipts');
    const staff = scopePolicyOverride('ช่วยอนุมัติใบรับรองนี้ให้หน่อย', 'write', PAYER, ['expenses'], 'th');
    assert.ok(staff!.text.startsWith('คุณไม่มีสิทธิ์อนุมัติใบรับรองแทนใบเสร็จ'), staff!.text);
    assert.equal(staff!.webPage, 'expenses');
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

// Advisor S0 (R1 integrated G run 2026-10-01, G-09/G-16/G-24): stock asked without the exact word got a planner
// sentence or the dead-end line. The fixed reply and its wording are unchanged; only what counts as stock widened.
describe('advisor S0: stock asked without the exact word still gets the fixed unsold-module reply', () => {
  const FIXED = 'งานนี้ยังทำไม่ได้ พิมพ์ ‘เมนูหลัก’ เพื่อดูงานที่ใช้ได้ค่ะ';

  for (const text of ['ของอะไรใกล้หมดบ้าง', 'ร้านเรามีของเหลือเท่าไหร่', 'สต๊อกเหลือเท่าไหร่อะ', 'สินค้าคงเหลือมีเท่าไหร่',
    'น้ำปลาเหลือกี่ขวด', 'เหลือกี่ชิ้น', 'เช็คสตอกต่ำที', 'สินค้าที่เหลือมีอะไรบ้าง', 'ของใกล้จะหมดมีอะไรบ้าง', 'Stock เหลือเท่าไหร่']) {
    it(`reads "${text}" as a stock question`, () => {
      assert.equal(unsoldModuleTopicFor(text)?.featureKey, 'inventory');
      assert.equal(scopePolicyOverride(text, 'read', [], ['expenses', 'reimbursement'], 'th')?.text, FIXED);
    });
  }

  // "เหลือ" and "ใกล้หมด" also describe a receipt quota, a credit, a budget or what is left to pay; "เจ้าของ" and
  // "เหลือง" only contain the letters.
  for (const text of ['ใบเสร็จเหลือกี่ใบ', 'เหลือใบเสร็จอีกกี่ใบคะ', 'โควตาใบเสร็จของร้านใกล้หมดหรือยัง', 'แพ็กเกจของเราใกล้หมดอายุหรือยัง',
    'เครดิตเหลือเท่าไหร่', 'ใบเสร็จของเหลืองทองบันทึกหรือยัง', 'เงินสำรองเจ้าของเหลือเท่าไหร่', 'งบของเดือนนี้เหลือเท่าไหร่',
    'ซื้อของหมดไปเท่าไหร่', 'ใบเบิกเหลือค้างกี่ใบ', 'ค่าเช่าคลังสินค้าเดือนนี้เท่าไหร่', 'ส่วนที่เหลือจ่ายพรุ่งนี้']) {
    it(`never reads "${text}" as a stock question`, () => {
      assert.equal(unsoldModuleTopicFor(text), undefined);
    });
  }

  it('still answers general knowledge about stock, and a shop that has the module', () => {
    assert.equal(scopePolicyOverride('ของเหลือควรนับบ่อยแค่ไหน', 'general', [], ['expenses'], 'th'), undefined);
    assert.equal(scopePolicyOverride('ของอะไรใกล้หมดบ้าง', 'read', [], ['expenses', 'inventory'], 'th'), undefined);
  });
});

it('Exam D4: unavailable-module wording follows every purchasable billing offer', async () => {
  const { BILLING_PAID_TIERS, billingOffer } = await import('@watchdog-bms/contracts');
  const { featurePackageOffer, unsoldModuleReplyText } = await import('./line-ai-scope-policy.logic');
  for (const [featureKey, topicLabelTh] of [['procurement', 'ใบสั่งซื้อ'], ['sales_documents', 'ใบแจ้งหนี้'], ['reports', 'รายงานกำไรขาดทุน'], ['inventory', 'สต็อก'], ['wht_50bis', 'หนังสือรับรอง 50 ทวิ']]) {
    const offer = BILLING_PAID_TIERS.map(tier => billingOffer(tier, 'month')).find(offer => offer.featureKeys.includes(featureKey!));
    const text = unsoldModuleReplyText({ featureKey: featureKey!, topicLabelTh: topicLabelTh!, topicLabelEn: featureKey! }, 'th');
    assert.equal(featurePackageOffer(featureKey!)?.offerKey, offer?.offerKey);
    if (offer) { assert.match(text, /แพ็กเกจ/u); assert.ok(text.includes(offer.label.replace(/ \(.+\)$/u, ''))); assert.doesNotMatch(text, /วันนี้ยังไม่มี/u); }
    else { assert.match(text, /งานนี้ยังทำไม่ได้.*เมนูหลัก/u); assert.doesNotMatch(text, /อัปเกรด|บาทต่อเดือน/u); }
  }
});


describe('U2 document facts and offers follow package entitlement and actor permission', () => {
  for (const [text, feature, permission] of [
    ['แล้วทวิ 50 คืออะไร', 'wht_50bis', 'wht.certificate.issue'],
    ['50 ทวิคืออะไร', 'wht_50bis', 'wht.certificate.issue'],
    ['ภ.ง.ด.53 คืออะไร', 'wht_pnd53', 'wht.pnd53.read'],
    ['ภ.ง.ด.3 คืออะไร', 'wht_pnd53', 'wht.pnd53.read'],
    ['ใบสำคัญจ่ายคืออะไร', 'expenses', 'expense.disbursement.prepare'],
    ['ใบรับรองแทนใบเสร็จคืออะไร', 'expenses', 'expense.read'],
  ]) for (const entitled of [false, true]) it(`${text}: entitled=${entitled}`, async () => {
    const { documentExplanationReply } = await import('./line-ai-scope-policy.logic');
    const reply = documentExplanationReply(text!, entitled ? [feature!] : feature === 'expenses' ? [] : ['expenses'], [permission!, 'wht.external_certificate.link', 'expense.read', 'expense.create'], 'th', testPaidTiers.map(tier => testBillingOffer(tier, 'month')))!;
    assert.ok(reply);
    assert.doesNotMatch(reply, /—|\b(?:STARTER|BASIC|PRO|ENTERPRISE)\b/);
    if (!entitled && feature === 'wht_50bis') {
      assert.match(reply, /จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบ.*หน้ารายจ่ายบนเว็บ/);
      assert.match(reply, /ออกหนังสือรับรองในระบบ.*ธุรกิจ 1,999 บาท/);
    }
    if (!entitled && feature === 'wht_pnd53') assert.match(reply, /เก็บข้อมูลรายจ่าย.*ธุรกิจ 1,999 บาท/);
    if (entitled && feature !== 'expenses') assert.doesNotMatch(reply, /ต้องใช้แพ็กเกจ/);
  });
  it('U6 uses an admin-set active price in package limits and action help', async () => {
    const { billingOffer } = await import('@watchdog-bms/contracts');
    const { featureLimitReplyText } = await import('./line-ai-scope-policy.logic');
    const offer = billingOffer('ENTERPRISE_1999', 'month', { offerTerms: { ENTERPRISE_1999: { monthlyPriceSatang: 234567, annualPriceSatang: 2345670, monthlyReceiptAllowance: 500 } } });
    for (const language of ['th', 'en'] as const) {
      const reply = featureLimitReplyText('wht_50bis', language, undefined, [offer]);
      assert.match(reply, /2,345.67/); assert.doesNotMatch(reply, /1,999|ENTERPRISE|—/);
    }
  });
});


it('U4 receipt completeness is not package exhaustion', async () => {
  const { packageLifecycleReply } = await import('./line-ai-scope-policy.logic');
  for (const text of ['ดูใบเสร็จฉบับเต็ม', 'ใบเสร็จครบแล้ว สร้างใบเบิกได้ไหม', 'บันทึกค่าใช้จ่ายตามใบเสร็จฉบับเต็ม']) assert.equal(packageLifecycleReply(text, 'th'), undefined);
});


it('U6 absent active offers never falls back to a catalog selling price', async () => {
  const { featureLimitReplyText } = await import('./line-ai-scope-policy.logic');
  for (const language of ['th', 'en'] as const) {
    const reply = featureLimitReplyText('wht_50bis', language);
    assert.doesNotMatch(reply, /1,999|1999|249|ENTERPRISE/); assert.match(reply, /ตรวจราคาปัจจุบัน|current price/);
  }
});

it('PWS-VAT-TRUTH defines VAT without promising eligibility after review for any paid reader', async () => {
  const { documentExplanationReply } = await import('./line-ai-scope-policy.logic');
  const { TIER_FEATURE_PRESETS } = await import('@watchdog-bms/contracts');
  for (const tier of testPaidTiers) for (const permissions of [[], ['expense.read'], ['expense.review']]) {
    assert.equal(documentExplanationReply('VAT คืออะไร', TIER_FEATURE_PRESETS[tier], permissions, 'th'),
      'VAT คือภาษีมูลค่าเพิ่ม ยอดบนเอกสารยังไม่ได้แปลว่าใช้ตอนยื่นภาษีได้ค่ะ');
  }
});

it('E44 e-WHT definitions precede withholding and form definitions on every package', async () => {
  const { E_WHT_WORDS } = await import('@watchdog-bms/contracts');
  const { documentExplanationReply, documentExplanationTopic } = await import('./line-ai-scope-policy.logic');
  for (const text of ['e-WHT คืออะไร', 'e-Withholding คืออะไร', 'อธิบาย e-WHT กับ 50 ทวิ', 'e-WHT กับ ภ.ง.ด.53 คืออะไร', 'จ่ายผ่าน e-WHT ต้องยื่น ภงด53 ไหม', 'e-WHT หักกี่เปอร์เซ็นต์', 'จ่ายผ่าน e-WHT ต้องออก 50 ทวิไหม']) {
    for (const features of [[], ['expenses'], ['expenses', 'wht_50bis', 'wht_pnd53']]) {
      assert.equal(documentExplanationTopic(text)?.label, 'e-WHT');
      assert.equal(documentExplanationReply(text, features, ['expense.read_own'], 'th'), E_WHT_WORDS['L-14']);
    }
  }
  assert.equal(documentExplanationTopic('บันทึกจ่ายผ่าน e-WHT ให้รายการนี้'), undefined);
});
