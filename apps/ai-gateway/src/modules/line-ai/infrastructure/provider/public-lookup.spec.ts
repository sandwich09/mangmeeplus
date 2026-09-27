import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_LOOKUP_SYSTEM_PROMPT, publicLookupPolicy, type PublicLookupRequest } from '@watchdog-bms/contracts';
import { OpenAiProvider } from './openai.provider';
import { normalizePublicLookupOutput, publicLookupExternalUnits } from './public-lookup-output.logic';
import { drainUsage, runWithUsageContext } from '../../../../common/usage/usage-context';
const request: PublicLookupRequest = { publicQuestion: 'อัตราดอกเบี้ยนโยบายล่าสุด', topic: 'rates', locale: 'th', temporalIntent: 'current', sourcePolicyId: 'thai-rates-v1' };
const policy = publicLookupPolicy(request)!;
const url = 'https://www.bot.or.th/th/rate.html', text = 'Synthetic policy rate evidence [1]';
const response = () => ({ status: 'completed', usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 40 } }, output: [
  { type: 'web_search_call', status: 'completed', action: { type: 'search', sources: [{ url }] } },
  { type: 'message', content: [{ type: 'output_text', text, annotations: [{ type: 'url_citation', url, title: 'Synthetic central bank source', start_index: 31, end_index: 34 }] }] },
] });
const input = () => ({ messages: [{ role: 'user' as const, text: JSON.stringify({ request, policy }) }], systemPrompt: PUBLIC_LOOKUP_SYSTEM_PROMPT, usageTag: 'line.public.lookup', maxTokens: 4096 });

describe('public Responses lookup contract', () => {
  it('sends a single bounded public-only request and retains cited segments plus actual hosted units', async () => {
    const original = globalThis.fetch; let calls = 0; let sent: any;
    globalThis.fetch = async (_url, init) => { calls++; sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify(response())); };
    try {
      await runWithUsageContext({ companyId: 'private-company-canary' }, async () => {
        const result = await new OpenAiProvider({ apiKey: 'fixture', model: 'gpt-4.1-mini', timeoutMs: 1000 }).generateText(input());
        assert.equal(result.ok, true); if (!result.ok) return;
        const value = JSON.parse(result.text);
        assert.equal(value.status, 'verified'); assert.equal(value.sources[0].url, url); assert.equal(value.sources[0].supportingText, text);
        assert.deepEqual(value.claims[0].sourceIds, ['public-1']); assert.equal(value.externalUnits, 1);
        const [usage] = drainUsage(); assert.equal(usage?.externalUnits, 1); assert.equal(usage?.inputTokens, 60); assert.equal(usage?.cacheReadInputTokens, 40);
      });
      assert.equal(calls, 1); assert.equal(sent.max_tool_calls, 2); assert.equal(sent.store, false); assert.equal(sent.tool_choice, 'required');
      assert.deepEqual(sent.tools, [{ type: 'web_search', external_web_access: true, filters: { allowed_domains: ['bot.or.th'] } }]);
      assert.deepEqual(sent.include, ['web_search_call.action.sources']); assert.equal(JSON.stringify(sent).includes('private-company-canary'), false);
      assert.deepEqual(JSON.parse(sent.input[0].content[0].text), request);
    } finally { globalThis.fetch = original; }
  });

  it('refuses extra history, private fields, credentials, wrong policy and unapproved URLs before outbound fetch', async () => {
    const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('unexpected egress'); };
    try {
      const provider = new OpenAiProvider({ apiKey: 'fixture', model: 'gpt-4.1-mini', timeoutMs: 1000 });
      for (const candidate of [
        { ...input(), cacheableContext: 'private-context' }, { ...input(), messages: [...input().messages, { role: 'assistant' as const, text: 'private-history' }] },
        { ...input(), messages: [{ role: 'user' as const, text: JSON.stringify({ request: { ...request, companyId: 'secret' }, policy }) }] },
        { ...input(), messages: [{ role: 'user' as const, text: JSON.stringify({ request: { ...request, publicQuestion: 'a@example.com' }, policy }) }] },
        { ...input(), messages: [{ role: 'user' as const, text: JSON.stringify({ request: { ...request, publicQuestion: 'https://evil.example/internal' }, policy }) }] },
        { ...input(), messages: [{ role: 'user' as const, text: JSON.stringify({ request, policy: { ...policy, domains: ['evil.example'] } }) }] },
      ]) assert.equal((await provider.generateText(candidate)).ok, false);
      assert.equal(calls, 0);
    } finally { globalThis.fetch = original; }
  });

  it('keeps incomplete hosted usage unknown and never retries an HTTP/provider failure', async () => {
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ...response(), status: 'incomplete' }), { status: 429 }); };
    try {
      await runWithUsageContext({}, async () => {
        const result = await new OpenAiProvider({ apiKey: 'fixture', model: 'gpt-4.1-mini', timeoutMs: 1000 }).generateText(input());
        assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.retryable, false);
        assert.equal(drainUsage()[0]?.externalUnits, null);
      });
      assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
  });

  it('does not promote a source list, an unsupported citation or unsafe URL into verified facts', () => {
    const sourceOnly = response(); sourceOnly.output.pop();
    assert.equal(normalizePublicLookupOutput(sourceOnly, policy).errorCode, 'UNVERIFIED_SOURCE');
    const unsupported = response(); unsupported.output[0]!.action!.sources = [];
    assert.equal(normalizePublicLookupOutput(unsupported, policy).errorCode, 'UNVERIFIED_SOURCE');
    const unsafe = response(); unsafe.output[1]!.content![0]!.annotations![0]!.url = 'https://bot.or.th@127.0.0.1/secret';
    assert.equal(normalizePublicLookupOutput(unsafe, policy).errorCode, 'UNVERIFIED_SOURCE');
    const over = response(); over.output.push(over.output[0]!, over.output[0]!);
    assert.equal(normalizePublicLookupOutput(over, policy).errorCode, 'PUBLIC_LOOKUP_LIMIT_EXCEEDED');
    assert.equal(publicLookupExternalUnits({ status: 'completed' }), null);
  });
  it('reports explicit disagreement only with two independently cited source URLs', () => {
    const body = response();
    const firstClaim = 'One dated source [1]'; const secondClaim = 'Another dated source [2]';
    const url2 = 'https://www.bot.or.th/th/other-date.html';
    body.output[0]!.action!.sources.push({ url: url2 });
    body.output[1]!.content![0] = { type: 'output_text', text: `${firstClaim}\n${secondClaim}\n[PUBLIC_SOURCE_CONFLICT]`, annotations: [
      { type: 'url_citation', url, title: 'First source', start_index: 17, end_index: 20 },
      { type: 'url_citation', url: url2, title: 'Second source', start_index: firstClaim.length + 1 + 21, end_index: firstClaim.length + 1 + 24 },
    ] };
    // Citation offsets are derived from each exact paragraph, not guessed page content.
    const content = body.output[1]!.content![0]!;
    content.annotations[0]!.start_index = firstClaim.indexOf('[1]'); content.annotations[0]!.end_index = firstClaim.length;
    content.annotations[1]!.start_index = firstClaim.length + 1 + secondClaim.indexOf('[2]'); content.annotations[1]!.end_index = firstClaim.length + 1 + secondClaim.length;
    assert.equal(normalizePublicLookupOutput(body, policy).status, 'conflict');
    content.annotations[1]!.url = url;
    assert.equal(normalizePublicLookupOutput(body, policy).status, 'partial');
  });

});
