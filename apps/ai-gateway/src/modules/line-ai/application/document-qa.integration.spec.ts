import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AI_BUDGET_PROFILE_TABLE_DIGEST_V2, LINE_DOCUMENT_QA_READER_VERSION, createLineAiInputEvidence, lineDocumentQaInputEvidenceText,
  type AiBudgetGrantV2, type LineDocumentQaGatewayRequest } from '@watchdog-bms/contracts';
import { DocumentQaUseCase } from './document-qa.use-case';
import { runWithUsageContext } from '../../../common/usage/usage-context';
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const config: any = { lineAiDocumentQaEnabled: true, modelProvider: 'openai', openAiApiKey: 'synthetic', openAiModel: 'gpt-4.1-mini',
  openAiProcessingRegion: 'US', approvedAiProviders: ['openai'], approvedAiModelIds: ['gpt-4.1-mini'], approvedAiRegions: ['US'],
  erpCoreInternalUrl: 'http://api.test/v1', aiGatewayInternalSecret: 'synthetic', aiToolTimeoutMs: 1000 };
const output = () => ({ version: 1, readerVersion: LINE_DOCUMENT_QA_READER_VERSION, answer: 'ยอดรวม1177จากหน้า2',
  answerPageRefs: [{ attachmentId: 'file-1', page: 2 }], pages: [{ attachmentId: 'file-1', page: 2, visibleText: 'TOTAL 1177',
    facts: [{ attachmentId: 'file-1', page: 2, text: '1177', role: 'total', localSpan: { start: 6, end: 10 } }],
    evidence: [{ attachmentId: 'file-1', page: 2, role: 'visible_text', text: 'TOTAL 1177', localSpan: { start: 0, end: 10 } }] }],
  coverage: { requested: [{ attachmentId: 'file-1', page: 2 }], read: [{ attachmentId: 'file-1', page: 2 }], failed: [] } });
async function request(cursor = 1, questions?: Array<{subrequestIndex:number;question:string}>): Promise<LineDocumentQaGatewayRequest & { budgetGrantV2: AiBudgetGrantV2 }> {
  const source = Buffer.from('synthetic-rendered-page');
  const pages = [{ attachmentId: 'file-1', page: 2, mimeType: 'image/png' as const, sourceMimeType: 'application/pdf' as const,
    contentHash: sha('original-pdf'), renderedSha256: sha(source), contentBase64: source.toString('base64') }];
  const question = 'หน้า2ยอดรวมเท่าไร', text = lineDocumentQaInputEvidenceText(question, pages, questions), now = Date.now();
  const evidence = await createLineAiInputEvidence({ turnKey: 'turn-1', parts: [{ partId: 'qa-manifest', eventIdHash: sha('event'), rawText: text, acceptedAtMs: now }] }); assert.ok(evidence);
  return { requestId: 'request', companyId: 'company', userId: 'user', jobId: 'job', jobRevision: 1, turnId: 'turn-1', question, pages, ...(questions ? { questions } : {}),
    messageText: evidence.messageText, inputEvidence: evidence.inputEvidence, inputDigest: evidence.inputEvidence.joinedSha256,
    inputSetHash: sha('set'), questionDigest: sha(question), readerVersion: LINE_DOCUMENT_QA_READER_VERSION,
    contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'], budgetGrantV2: { version: 2, authorityKind: 'qa_job', authorityId: 'job',
      turnKey: 'turn-1', channelOwnerDigest: sha('owner'), attemptKey: 'attempt', monthKey: '2026-09', payerCompanyId: 'company',
      model: { provider: 'openai', modelId: 'gpt-4.1-mini', region: 'US' }, allowedProfileIds: ['document-qa/2'], profileTableDigest: AI_BUDGET_PROFILE_TABLE_DIGEST_V2,
      maxTurnSlots: 2, maxRepairs: 1, admittedAtMs: now, workDeadlineAtMs: now + 897000, finalDeadlineAtMs: now + 900000,
      nonce: 'nonce', issuerVersion: 'fixture:1', nextOrdinal: cursor, membershipEpoch: 0, signature: sha('synthetic-signature') } };
}
async function execute(input: Awaited<ReturnType<typeof request>>, responses: unknown[]) {
  const original = globalThis.fetch, reservations: any[] = [], vendor: any[] = [], settlements: any[] = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/budget-step')) {
      reservations.push(body);
      return new Response(JSON.stringify({ ok: true, envelope: { ...body.invocation, version: 2, reservationId: `reservation-${body.invocation.ordinal}`,
        invocationKey: `company#attempt#provider-v2#${body.invocation.ordinal}`, tariffVersion: 'fixture:1' } }));
    }
    if (String(url).endsWith('/budget-settle')) { settlements.push(body); return new Response(JSON.stringify({ result: 'settled' })); }
    assert.equal(String(url), 'https://api.openai.com/v1/responses'); vendor.push(body);
    const answer = responses[Math.min(vendor.length - 1, responses.length - 1)];
    return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 100, output_tokens: 50 },
      output: [{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] }] }));
  };
  try {
    const result = await runWithUsageContext({ companyId: input.companyId, budget: { status: 'active-v2', grant: input.budgetGrantV2,
      inputDigest: input.inputDigest, sourceRoute: 'line-document-qa', calls: input.budgetGrantV2.nextOrdinal!, repairCount: 0 } },
    () => new DocumentQaUseCase(config).execute(input));
    return { result, reservations, vendor, settlements };
  } finally { globalThis.fetch = original; }
}
test('real QA usecase/wrapper/OpenAI adapter carries selected page identities, one sealed dispatch and usage settlement', async () => {
  const actual = await execute(await request(), [output()]);
  assert.equal(actual.result.status, 'ok'); assert.equal(actual.vendor.length, 1); assert.equal(actual.reservations[0].invocation.ordinal, 1);
  assert.equal(actual.reservations[0].invocation.profileId, 'document-qa/2'); assert.equal(actual.settlements.length, 1);
  const wire = JSON.stringify(actual.vendor[0]); assert.ok(wire.includes('file-1')); assert.ok(wire.includes('selectedPagesInImageOrder'));
});
test('intake+reader invalid output gets no third provider call; direct accepted QA may repair once', async () => {
  const used = await execute(await request(1), ['invalid-json', output()]);
  assert.equal(used.result.status, 'failed'); assert.equal(used.vendor.length, 1);
  const direct = await execute(await request(0), ['invalid-json', output()]);
  assert.equal(direct.result.status, 'ok'); assert.equal(direct.vendor.length, 2);
  assert.deepEqual(direct.reservations.map(call => call.invocation.ordinal), [0, 1]); assert.equal(direct.reservations[1].repair, true);
});
test('transplanted question/rendered bytes, missing coverage and invented evidence never produce a successful answer', async () => {
  const input = await request(); input.question = 'different question';
  assert.equal((await execute(input, [output()])).vendor.length, 0);
  const bytes = await request(); bytes.pages[0]!.contentBase64 = Buffer.from('other bytes').toString('base64');
  assert.equal((await execute(bytes, [output()])).vendor.length, 0);
  const absent = output(); absent.coverage.read = [];
  assert.equal((await execute(await request(), [absent])).result.status, 'failed');
  const invented = output(); invented.pages[0]!.facts[0]!.text = '1200';
  assert.equal((await execute(await request(), [invented])).result.status, 'failed');
});

test('same reader call must cover every offered file clause; missing coverage cannot spend a third call', async () => {
  const questions = [{ subrequestIndex: 1, question: 'หน้า2ยอดรวมเท่าไร' }];
  const missing = await execute(await request(1, questions), [output()]);
  assert.equal(missing.result.status, 'failed'); assert.equal(missing.vendor.length, 1);
  const answer = { ...output(), questionCoverage: [{ subrequestIndex: 1, status: 'answered', answer: '1177', answerPageRefs: [{ attachmentId: 'file-1', page: 2 }] }] };
  const actual = await execute(await request(1, questions), [answer]);
  assert.equal(actual.result.status, 'ok'); assert.equal(actual.vendor.length, 1);
  assert.ok(JSON.stringify(actual.vendor[0]).includes('subrequestIndex'));
});
