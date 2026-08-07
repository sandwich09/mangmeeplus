import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CoverageCriticAgent, parseCoverage, COVERAGE_CRITIC_SYSTEM_PROMPT } from './coverage-critic.agent';
import type { ProviderInput } from '../infrastructure/provider/provider.port';

describe('parseCoverage (item 10F)', () => {
  it('parses plain and fenced JSON arrays with bounded fields', () => {
    const raw = [
      { request: 'ยอดขายวันนี้', verdict: 'covered' },
      { request: 'ของใกล้หมด', verdict: 'uncovered', reason: 'budget' },
      { request: 'วันที่บิล', verdict: 'needs_user', question: 'หมายถึง 9 พ.ย. 2537 หรือ 2580?' },
    ];
    assert.deepEqual(parseCoverage(JSON.stringify(raw)), raw);
    assert.deepEqual(parseCoverage('```json\n' + JSON.stringify(raw) + '\n```'), raw);
  });

  it('drops malformed entries, unknown verdicts, and JSON-shaped questions', () => {
    const parsed = parseCoverage(JSON.stringify([
      { request: 'ok', verdict: 'covered' },
      { request: '', verdict: 'covered' },
      { request: 'x', verdict: 'maybe' },
      { request: 'ask', verdict: 'needs_user', question: '{"i":"am json"}' },
      'not-an-object',
    ]));
    assert.equal(parsed?.length, 2);
    assert.equal(parsed?.[1].question, undefined, 'JSON-shaped question dropped');
  });

  it('returns null for non-array or unparseable output (fail-open signal)', () => {
    assert.equal(parseCoverage('not json at all'), null);
    assert.equal(parseCoverage('{"verdicts": []}'), null);
    assert.equal(parseCoverage('[]'), null);
  });

  it('bounds the number of items', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ request: `r${i}`, verdict: 'covered' }));
    assert.equal(parseCoverage(JSON.stringify(many))?.length, 8);
  });
});

describe('CoverageCriticAgent.judge', () => {
  it('sends message/tools/facts as DATA and returns verdicts', async () => {
    let captured: ProviderInput | undefined;
    const agent = new CoverageCriticAgent({
      generateText: async (input: ProviderInput) => {
        captured = input;
        return { ok: true, text: JSON.stringify([{ request: 'ยอดขาย', verdict: 'covered' }]) };
      },
    });
    const verdicts = await agent.judge({
      messageText: 'ยอดขายวันนี้เท่าไหร่',
      language: 'th',
      toolsCalled: ['sales.get_sales_summary'],
      facts: [{ label: 'ยอดขาย', value: '12,500' }],
    });
    assert.equal(verdicts?.[0]?.verdict, 'covered');
    assert.equal(captured?.systemPrompt, COVERAGE_CRITIC_SYSTEM_PROMPT);
    const payload = JSON.parse(captured?.messages[0]?.text ?? '{}');
    assert.deepEqual(payload.toolsCalled, ['sales.get_sales_summary']);
    assert.equal(payload.facts[0].value, '12,500');
  });

  it('returns null on provider failure (fail-open)', async () => {
    const agent = new CoverageCriticAgent({
      generateText: async () => ({ ok: false, error: { code: 'PROVIDER_TIMEOUT', message: 't', retryable: true } }),
    });
    assert.equal(await agent.judge({ messageText: 'x', language: 'th', toolsCalled: [], facts: [] }), null);
  });
});
