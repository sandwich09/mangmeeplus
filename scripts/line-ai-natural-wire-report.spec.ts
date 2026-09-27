import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWireLink, inspectWireMessages, renderNaturalWireReport, repositoryWebRoutes } from './line-ai-natural-wire-report';
import type { RuntimeTurnEvidence } from './line-ai-reliability-runtime';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const routes = repositoryWebRoutes(repoRoot);
const boundary = { line: 'synthetic_http_sink', nativeLineVerified: false, activationEligible: false };
const wire = [{ type: 'flex', altText: 'สรุป 250.00 บาท', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '250.00 บาท' }] }, footer: { type: 'box', layout: 'vertical', contents: [
  { type: 'button', action: { type: 'postback', label: 'ยืนยัน', data: 'action=confirm&previewId=actual-preview' } },
  { type: 'button', action: { type: 'uri', label: 'ดูบิล', uri: 'https://example.test/companies/company-a/expenses/expense-a' } },
] } }, quickReply: { items: [{ type: 'action', action: { type: 'message', label: 'ยกเลิก', text: 'ยกเลิก' } }] } }];
const evidence = (): RuntimeTurnEvidence => ({
  scenarioId: 'NAT-01', repeat: 0, turnIndex: 0, user: 'เมื่อกี้เท่าไหร่นะ', attachmentIds: [], companyId: 'company-a', sourceSnapshot: 'source-a', snapshotDigest: 'a'.repeat(64),
  webBaseUrl: 'https://example.test', acceptedAtMs: 100, modelWorkCompletedAtMs: 180, receipts: [{ messages: wire, at: 220, receiptId: 'sink-a', path: '/v2/bot/message/reply', payloadHash: 'b'.repeat(64) }],
  toolResults: [{ tool: 'expense.get_detail', input: { id: 'expense-a' }, startedAtMs: 105, completedAtMs: 140, result: { status: 'ok', data: { amount: '250.00' } } as any }],
  gatewayResponses: [{ method: 'requestLineIntakeRoute', requestId: 'request-a', startedAtMs: 101, completedAtMs: 170, response: { semanticSubrequests: [{ intent: 'READ' }], preparedPlan: { steps: ['read'] } } }],
  webhookEvents: [{ status: 'completed', errorCode: null }], providerUsage: [{ modelId: 'actual-model-a', inputTokens: 200, outputTokens: 30, usageBasis: 'PROVIDER_REPORTED' }], reservations: [],
  reviewState: { before: { draftActions: [], conversations: [], truncated: false }, after: { draftActions: [{ status: 'PREVIEW' }], conversations: [], truncated: false } },
  delivery: { requiredBatchIds: ['batch-a'], accepted: [{ batchId: 'batch-a', wireHash: 'c'.repeat(64), acceptedAtMs: 220, receiptId: 'sink-a' }], status: 'ACCEPTED' },
});

test('wire inspection uses actual repository envelope and retains Flex/actions/links', () => {
  const result = inspectWireMessages(wire, 'company-a', 'https://example.test', routes);
  assert.equal(result.envelopeValid, true);
  assert.deepEqual(result.texts, ['250.00 บาท']);
  assert.deepEqual(result.actions.map(action => action.type), ['postback', 'uri', 'message']);
  assert.equal(result.links[0]?.status, 'same_company_route_exists');
  assert.equal(result.links[0]?.source, 'apps/web/app/(workspace)/companies/[companyId]/expenses/[expenseId]/page.tsx');
  assert.deepEqual(result.issues, []);
  assert.equal(inspectWireMessages([{ type: 'text', text: 'x'.repeat(5001) }], '', undefined, routes).envelopeValid, false);
  assert.ok(inspectWireMessages([{ ...wire[0], canonicalText: 'internal' }], 'company-a', undefined, routes).issues.includes('internal_canonicalText_on_wire'));
});

test('static URLs distinguish actual route, cross tenant, offsite, missing route and unknown origin', () => {
  const inspect = (url: string) => inspectWireLink(url, 'company-a', 'https://example.test', routes);
  assert.equal(inspect('https://example.test/companies/company-a/reimbursements/draft-actions/action-a').status, 'same_company_route_exists');
  assert.equal(inspect('https://example.test/companies/company-a/expenses/manual').route, '/companies/[companyId]/expenses/manual');
  assert.equal(inspect('https://example.test/l/one-time-token').status, 'same_origin_route_exists');
  assert.equal(inspect('https://example.test/companies/company-b/expenses/expense-a').status, 'cross_company');
  assert.equal(inspect('https://example.test/companies/company-a/not-a-real-route').status, 'route_not_found');
  assert.equal(inspect('https://elsewhere.test/companies/company-a/expenses/expense-a').status, 'external_not_checked');
  assert.equal(inspect('javascript:alert(1)').status, 'invalid_url');
  assert.equal(inspect('https://secret:password@example.test/login').status, 'invalid_url');
  assert.equal(inspect('https://example.test/companies/company-a%2fcompany-b/expenses/a').status, 'invalid_url');
  assert.equal(inspectWireLink('https://example.test/login', 'company-a', undefined, routes).status, 'origin_unknown');
});

test('plain outgoing answer links receive the same tenant and route checks as URI actions', () => {
  const result = inspectWireMessages([{ type: 'text', text: [
    'เปิดดู: https://example.test/companies/company-a/expenses/manual',
    'ผิดบริษัท: https://example.test/companies/company-b/expenses/expense-a',
    'ไม่มีหน้า: https://example.test/companies/company-a/missing-page',
  ].join('\n') }], 'company-a', 'https://example.test', routes);
  assert.deepEqual(result.links.map(link => link.status), ['same_company_route_exists', 'cross_company', 'route_not_found']);
});

test('punctuation and adjacent Thai do not become app URL bytes, while query and escaped Thai survive', () => {
  const url = 'https://example.test/companies/company-a/expenses/manual?label=%E0%B8%9A%E0%B8%B4%E0%B8%A5&mode=review#details';
  const result = inspectWireMessages([{ type: 'text', text: `เปิด(${url}).แล้วตรวจอีกครั้ง ดูhttps://example.test/companies/company-a/missing-page,ค่ะ` }], 'company-a', 'https://example.test', routes);
  assert.deepEqual(result.links.map(link => [link.url, link.status]), [[url, 'same_company_route_exists'],
    ['https://example.test/companies/company-a/missing-page', 'route_not_found']]);
});

test('text, Flex altText and leaked canonicalText links are inspected once alongside URI actions', () => {
  const url = 'https://example.test/companies/company-b/expenses/expense-a';
  const result = inspectWireMessages([{ type: 'text', text: url }, { type: 'flex', altText: `ดู ${url}`, canonicalText: `เปิด ${url}`,
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: url }, { type: 'button', action: { type: 'uri', uri: url, label: 'ดู' } }] } } }], 'company-a', 'https://example.test', routes);
  assert.deepEqual(result.links, [{ url, status: 'cross_company' }]);
  assert.ok(result.issues.includes('internal_canonicalText_on_wire'));
});

test('report shows actual wire, numeric sources, usage, state and timing without claiming native acceptance', () => {
  const html = renderNaturalWireReport({ boundary, turnEvidence: [evidence()] }, repoRoot);
  for (const text of ['เมื่อกี้เท่าไหร่นะ', '250.00 บาท', 'actual-model-a', 'PROVIDER_REPORTED', 'semanticSubrequests', 'preparedPlan', 'PREVIEW', '80 ms', '120 ms', 'UNREVIEWED']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('<button disabled>ยืนยัน</button>'));
  assert.ok(html.includes('ภาพการ์ดนี้จัดวางโดยประมาณ'));
  assert.ok(html.includes('ไม่ใช่ภาพจากแอป LINE'));
  assert.ok(!html.includes('href='));
});

test('manifest preserves all 60 turn denominator and does not invent missing answers or zero usage', () => {
  const manifest = { repeats: 1, corpus: { fixtures: Array.from({ length: 12 }, (_, index) => ({ id: `NAT-${String(index + 1).padStart(2, '0')}`, turns: Array.from({ length: 5 }, (_, turn) => ({ user: `คำถาม ${index + 1}/${turn + 1}`, attachmentIds: [] })) })) } } as any;
  const actual = evidence(); actual.providerUsage = []; actual.receipts = [];
  const html = renderNaturalWireReport({ boundary, turnEvidence: [actual] }, repoRoot, { manifest });
  assert.equal((html.match(/<section>/g) ?? []).length, 60);
  assert.ok(html.includes('จำนวนข้อในรายงาน 60 · มีหลักฐาน 1 · ไม่มีหลักฐาน 59'));
  assert.ok(html.includes('NAT-12 · รอบ 1 · ข้อ 5'));
  assert.ok(html.includes('ไม่มีแถวที่เก็บได้ — ยังใช้ยืนยันจำนวน provider calls ไม่ได้'));
  assert.equal((html.match(/ไม่มีหลักฐานรอบนี้:/g) ?? []).length, 59);
  assert.ok(html.includes('input ในหลักฐานไม่ตรง manifest'));
  assert.ok(html.includes('เมื่อกี้เท่าไหร่นะ'));
});

test('untrusted payload stays inert and cannot run HTML, navigate or load media', () => {
  const actual = evidence();
  actual.user = '<script>alert("user")</script>';
  actual.receipts[0]!.messages = [{ type: 'text', text: '<img src=x onerror=alert(1)>' }, { type: 'image', originalContentUrl: 'https://example.test/private.png', previewImageUrl: 'https://example.test/private.png' }];
  const html = renderNaturalWireReport({ boundary, turnEvidence: [actual] }, repoRoot);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img '));
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('&lt;img src=x'));
  assert.ok(html.includes("default-src 'none'"));
});

test('ambiguous duplicate evidence and an unsupported native boundary fail closed', () => {
  assert.throws(() => renderNaturalWireReport({ boundary, turnEvidence: [evidence(), evidence()] }, repoRoot), /DUPLICATE_TURN_EVIDENCE/);
  assert.throws(() => renderNaturalWireReport({ boundary: { ...boundary, nativeLineVerified: true }, turnEvidence: [] }, repoRoot), /EXPLICIT_SYNTHETIC_BOUNDARY/);
  assert.throws(() => renderNaturalWireReport({ boundary, turnEvidence: [] }, repoRoot, {} as any), /INVALID_MANIFEST/);
});
