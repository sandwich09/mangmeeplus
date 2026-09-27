import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicLookupRequest, publicQueryNeedsRephrase, publicSourceUrl, type PublicLookupSourcePolicy } from './line-ai-public-lookup.js';
const policy: PublicLookupSourcePolicy = { id: 'th-rates', version: 1, topics: ['rates'], domains: ['bot.or.th'], freshnessSeconds: 60 };
const request = { publicQuestion: 'อัตราดอกเบี้ยนโยบายล่าสุด', topic: 'rates', locale: 'th', temporalIntent: 'current', sourcePolicyId: 'th-rates' };
describe('public lookup request and egress contract', () => {
  it('rebuilds only exact public fields, refusing hidden history and silent truncation', () => {
    assert.deepEqual(parsePublicLookupRequest(request), request);
    assert.ok(parsePublicLookupRequest({ ...request, publicQuestion: 'ก'.repeat(1000) }));
    for (const bad of [{ ...request, publicQuestion: 'ก'.repeat(1001) }, { ...request, history: [] }, { ...request, companyId: 'private' },
      { ...request, locale: ['th'] }, { ...request, temporalIntent: ['current'] }, { ...request, topic: 'private_account' }]) {
      assert.equal(parsePublicLookupRequest(bad), undefined);
    }
  });
  it('blocks known tenant canaries and PII without sending the private deny list downstream', () => {
    for (const question of ['รายได้ CANARY-CUSTOMER-ALPHA ล่าสุด', 'ค้น john@example.com', 'เบอร์ 081-234-5678',
      'เลข 1234567890123', 'ค้น /companies/private-ledger', 'ที่ localhost', 'bearer secretsecretsecret', 'sk-secretsecretsecret']) {
      assert.equal(publicQueryNeedsRephrase(question, ['CANARY-CUSTOMER-ALPHA']), true, question);
    }
    assert.equal(publicQueryNeedsRephrase('CANARY-\u200bCUSTOMER-ALPHA', ['CANARY-CUSTOMER-ALPHA']), true);
    assert.equal(publicQueryNeedsRephrase(request.publicQuestion, ['ร้านของเรา']), false);
    assert.equal(publicQueryNeedsRephrase('อัตราแลกเปลี่ยนวันที่ 2026-09-27', []), false);
  });
  it('accepts only public HTTPS URLs under the approved exact domain boundary', () => {
    assert.equal(publicSourceUrl('https://www.bot.or.th/rates', policy), 'https://www.bot.or.th/rates');
    for (const url of ['http://bot.or.th', 'https://bot.or.th.evil.com', 'https://evilbot.or.th',
      'https://user:pass@bot.or.th', 'https://bot.or.th:444', 'https://127.0.0.1', 'https://[::1]',
      'https://169.254.169.254/latest/meta-data', 'https://localhost', 'https://bot.or.th\\@evil.com', 'https://bot.or.th /rates']) {
      assert.equal(publicSourceUrl(url, policy), undefined, url);
    }
  });
});
