import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { LineAiSuggestionUseCase } from './line-ai-suggestion.use-case';

const WEB = 'https://app.example.com';

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'r', authSubject: 's', userId: 'u1', companyId: 'co-1', membershipId: 'm',
    roles: ['SALES'], permissions: ['ai.suggestion.request', 'ai.suggestion.read_own', 'crm.customer.read'],
    scopes: {}, authProvider: 'line', ...overrides,
  } as any;
}

function makeUseCase(overrides: { create?: any; list?: any } = {}) {
  const create = overrides.create ?? { execute: mock.fn(async () => ({ id: 'req1', status: 'QUEUED' })) };
  const list = overrides.list ?? { execute: mock.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 10 })) };
  return { uc: new LineAiSuggestionUseCase(create as any, list as any), create, list };
}

describe('LineAiSuggestionUseCase', () => {
  it('refuses any create/accept/mutation ask from LINE (web-only)', async () => {
    const { uc, create } = makeUseCase();
    const out = await uc.handleTurn(ctx(), 'ช่วยสร้างร่างใบเสนอราคาให้หน่อย', WEB);
    assert.equal(out.intent, 'refuse_web_only');
    assert.equal(out.refused, true);
    assert.match(out.text, /ไม่สามารถ/);
    assert.equal(create.execute.mock.calls.length, 0); // nothing created
  });

  it('creates a draft request (origin LINE) on a suggestion ask', async () => {
    const { uc, create } = makeUseCase();
    const out = await uc.handleTurn(ctx(), 'ขอคำแนะนำการติดตามลูกค้า', WEB);
    assert.equal(out.intent, 'request');
    assert.equal(out.refused, false);
    assert.equal(out.requestId, 'req1');
    assert.equal(create.execute.mock.calls.length, 1);
    assert.equal(create.execute.mock.calls[0]!.arguments[1].origin, 'LINE');
    assert.match(out.text, /app.example.com\/companies\/co-1\/ai-suggestions/);
  });

  it('summarizes pending suggestions with source labels and a web deep link', async () => {
    const list = { execute: mock.fn(async () => ({ items: [{ title: 'Follow up ACME', riskLevel: 'MEDIUM', citationCount: 1 }], total: 1, page: 1, pageSize: 10 })) };
    const { uc } = makeUseCase({ list });
    const out = await uc.handleTurn(ctx(), 'มีรายการรออะไรบ้าง', WEB);
    assert.equal(out.intent, 'pending_summary');
    assert.match(out.text, /รอรีวิว 1 รายการ/);
    assert.match(out.text, /Follow up ACME/);
  });

  it('falls back to help when the user cannot request any available template', async () => {
    const { uc, create } = makeUseCase();
    const out = await uc.handleTurn(ctx({ permissions: ['ai.suggestion.read_own'] }), 'ขอคำแนะนำ', WEB);
    assert.equal(out.intent, 'request');
    assert.equal(create.execute.mock.calls.length, 0);
    assert.match(out.text, /ช่วย/);
  });
});
