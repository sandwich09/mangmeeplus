import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent, chooseAgent, selectTools, getRefusalReason, validateTurnRequest } from './line-ai-turn.logic';
import type { LineAiTurnRequest } from '@watchdog-bms/contracts';

describe('classifyIntent', () => {
  it('returns mutation_request for Thai mutation keyword', () => {
    assert.equal(classifyIntent('ชำระเงิน'), 'mutation_request');
  });
  it('returns mutation_request for approve keyword', () => {
    assert.equal(classifyIntent('approve this'), 'mutation_request');
  });
  it('returns unsupported_module for accounting keyword', () => {
    assert.equal(classifyIntent('บัญชีบริษัท'), 'unsupported_module');
  });
  it('routes import/export, PP36, and SAP Tax Code questions as tax reads', () => {
    for (const text of ['สรุปภาษีนำเข้าและส่งออก', 'ภ.พ.36 งวดนี้', 'sap tax code o1 คืออะไร']) {
      const intent = classifyIntent(text);
      assert.equal(intent, 'read_summary');
      assert.equal(chooseAgent(intent, text), 'tax');
    }
  });
  it('keeps tax configuration, filing, payment, and recompute requests blocked', () => {
    for (const text of ['เปิดใช้งาน tax code o1', 'ยื่นภาษี ภ.พ.30', 'ชำระภาษี', 'recompute tax pp30']) {
      assert.equal(classifyIntent(text), 'mutation_request');
    }
  });
  it('returns read_detail for inventory text', () => {
    assert.equal(classifyIntent('ดูสต็อกสินค้า'), 'read_detail');
  });
  it('returns read_summary for notification text', () => {
    assert.equal(classifyIntent('มีแจ้งเตือน'), 'read_summary');
  });
  it('returns read_summary for unrecognized text', () => {
    assert.equal(classifyIntent('how are you'), 'read_summary');
  });
});

describe('selectTools', () => {
  it('returns empty for mutation_request', () => {
    assert.equal(selectTools('general', 'mutation_request').length, 0);
  });
  it('returns empty for unsupported_module', () => {
    assert.equal(selectTools('inventory', 'unsupported_module').length, 0);
  });
  it('returns read tools for general agent read_summary', () => {
    const tools = selectTools('general', 'read_summary');
    assert.ok(tools.length > 0);
    assert.ok(tools.every((t) => ['read_summary', 'read_detail', 'report', 'suggestion', 'evidence_capture'].includes(t.category)));
  });
  it('returns only LINE-allowed categories', () => {
    const tools = selectTools('inventory', 'read_detail');
    assert.ok(tools.every((t) => t.category === 'read_summary' || t.category === 'read_detail'));
  });

  it('prioritizes low stock tool for low stock questions', () => {
    const [first] = selectTools('inventory', 'read_detail', 'low stock');
    assert.equal(first?.name, 'inventory.list_low_stock');
  });
  it('does not return draft_create or final_mutation tools', () => {
    const tools = selectTools('general', 'read_summary');
    assert.ok(tools.every((t) => t.category !== 'draft_create' && t.category !== 'final_mutation'));
  });
  it('inventory agent gets inventory tools', () => {
    const tools = selectTools('inventory', 'read_detail');
    assert.ok(tools.some((t) => t.name.startsWith('inventory.')));
  });
  it('prioritizes profile, transaction, and reconciliation tax read tools', () => {
    assert.equal(selectTools('tax', 'read_summary', 'sap tax code o1')[0]?.name, 'tax.get_tax_code_profile');
    assert.equal(selectTools('tax', 'read_summary', 'ภาษีนำเข้า ภ.พ.36')[0]?.name, 'tax.get_transaction_tax_summary');
    assert.equal(selectTools('tax', 'read_summary', 'กระทบยอด tax event กับ g/l')[0]?.name, 'tax.get_reconciliation_summary');
  });
});

describe('getRefusalReason', () => {
  it('returns mutation_blocked for mutation_request', () => {
    assert.equal(getRefusalReason('mutation_request'), 'mutation_blocked');
  });
  it('returns unsupported_module for unsupported_module', () => {
    assert.equal(getRefusalReason('unsupported_module'), 'unsupported_module');
  });
  it('returns forbidden for forbidden', () => {
    assert.equal(getRefusalReason('forbidden'), 'forbidden');
  });
  it('returns undefined for read_summary', () => {
    assert.equal(getRefusalReason('read_summary'), undefined);
  });
});

describe('validateTurnRequest', () => {
  const validReq: LineAiTurnRequest = {
    requestId: 'req-1',
    webhookEventId: 'evt-1',
    userContext: { lineUserId: '[REDACTED]', internalUserId: 'u1', companyId: 'c1', membershipId: 'm1', permissions: [], roles: [], locale: 'th-TH' },
    messageText: 'hello',
    messagePreviewHash: 'abc123',
  };

  it('returns null for valid request', () => {
    assert.equal(validateTurnRequest(validReq), null);
  });
  it('returns error for missing requestId', () => {
    assert.ok(validateTurnRequest({ ...validReq, requestId: '' }) !== null);
  });
  it('returns error for missing companyId', () => {
    const req = { ...validReq, userContext: { ...validReq.userContext, companyId: '' } };
    assert.ok(validateTurnRequest(req) !== null);
  });
  it('returns error for missing internalUserId', () => {
    const req = { ...validReq, userContext: { ...validReq.userContext, internalUserId: '' } };
    assert.ok(validateTurnRequest(req) !== null);
  });
  it('returns error for missing messageText', () => {
    assert.ok(validateTurnRequest({ ...validReq, messageText: '' }) !== null);
  });
});
