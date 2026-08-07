import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GenerateDraftUseCase } from './generate-draft.use-case';

const req = {
  templateKey: 'crm_followup_next_action', language: 'th-TH', agent: 'CRM' as const, domain: 'SALES_CRM' as const,
  defaultTitle: 'Follow up ACME', facts: ['Customer ACME has status ACTIVE.'], citations: [{ label: 'Customer ACME' }], wantsChecklist: false,
};

function providerReturning(text: string) {
  return { generateText: async () => ({ ok: true as const, text }) } as any;
}

describe('GenerateDraftUseCase (AI Gateway)', () => {
  it('parses and validates well-formed model JSON', async () => {
    const uc = new GenerateDraftUseCase();
    const model = providerReturning(JSON.stringify({
      title: 'Call ACME', summary: 's', recommendation: 'Do the follow-up', riskLevel: 'HIGH', confidence: 0.8,
      actionTitle: 'Call ACME re renewal', checklistItems: ['a', 'b'],
    }));
    const out = await uc.execute(model, req);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.title, 'Call ACME');
      assert.equal(out.recommendation, 'Do the follow-up');
      assert.equal(out.riskLevel, 'HIGH');
      assert.equal(out.confidence, 0.8);
      assert.equal(out.provider, 'bedrock');
    }
  });

  it('extracts JSON even when the model wraps it in a code fence', async () => {
    const uc = new GenerateDraftUseCase();
    const model = providerReturning('```json\n{"summary":"x","recommendation":"y"}\n```');
    const out = await uc.execute(model, req);
    assert.equal(out.ok, true);
  });

  it('rejects invalid JSON as MODEL_OUTPUT_INVALID', async () => {
    const uc = new GenerateDraftUseCase();
    const out = await uc.execute(providerReturning('not json at all'), req);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.error.code, 'MODEL_OUTPUT_INVALID');
  });

  it('rejects output with no summary/recommendation', async () => {
    const uc = new GenerateDraftUseCase();
    const out = await uc.execute(providerReturning(JSON.stringify({ title: 't' })), req);
    assert.equal(out.ok, false);
  });

  it('clamps an out-of-range confidence and drops an invalid riskLevel', async () => {
    const uc = new GenerateDraftUseCase();
    const out = await uc.execute(providerReturning(JSON.stringify({ summary: 's', recommendation: 'r', confidence: 5, riskLevel: 'EXTREME' })), req);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.confidence, 1);
      assert.equal(out.riskLevel, undefined);
    }
  });

  it('passes through a provider error', async () => {
    const uc = new GenerateDraftUseCase();
    const model = { generateText: async () => ({ ok: false as const, error: { code: 'PROVIDER_DISABLED', message: 'off', retryable: false } }) } as any;
    const out = await uc.execute(model, req);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.error.code, 'PROVIDER_DISABLED');
  });
});
