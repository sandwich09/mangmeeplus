import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  eligibleKnowledgeCards, knowledgeCardHash, knowledgePackHash, offeredKnowledgeMetadata,
  parseSelectedKnowledgeCardIds, renderApprovedKnowledge, validateKnowledgePack,
  type KnowledgeAccess, type ProductKnowledgePack,
} from './approved-knowledge';
import { PRODUCT_HELP_PACK } from './approved-product-help';

const access = (): KnowledgeAccess => ({
  release: '2.4.0', permissions: ['expense.read', 'expense.read_own', 'expense.review', 'expense.export', 'reimbursement.read', 'report.catalog.read'],
  featureKeys: ['expenses', 'reports'], capabilities: ['expense.list_recent'], member: true,
  now: new Date('2026-10-01T00:00:00Z'),
});
function reviewed(): ProductKnowledgePack {
  return structuredClone(PRODUCT_HELP_PACK);
}
const rehash = (pack: ProductKnowledgePack) => {
  for (const card of pack.cards) card.contentHash = knowledgeCardHash(card);
  pack.contentHash = knowledgePackHash(pack);
  return pack;
};

describe('approved product knowledge eligibility, source integrity and rendering', () => {
  it('validates bounded curated bodies against the exact checked-in manual source hashes', () => {
    validateKnowledgePack(PRODUCT_HELP_PACK);
    assert.equal(PRODUCT_HELP_PACK.status, 'APPROVED');
    assert.deepEqual(PRODUCT_HELP_PACK.reviewers, ['repository-ai-source-code-review:codex-gpt-5.6-sol:2026-09-27']);
    const root = resolve(__dirname, '../../../../../..');
    for (const card of PRODUCT_HELP_PACK.cards) {
      assert.equal(createHash('sha256').update(readFileSync(resolve(root, card.sourceFile))).digest('hex'), card.sourceHash, card.sourceFile);
      const guide = card.sourceURL.split('/user-guide/')[1]!.split('#')[0]!;
      assert.ok(readFileSync(resolve(root, `apps/web/app/(workspace)/companies/[companyId]/user-guide/${guide}/page.tsx`)), 'citation page exists');
    }
  });

  it('offers nothing from draft, retired, unreviewed, expired or wrong-release packs', () => {
    const draft = reviewed(); draft.status = 'DRAFT'; draft.reviewers = []; rehash(draft);
    assert.deepEqual(eligibleKnowledgeCards(draft, access()), []);
    const retired = reviewed(); retired.status = 'RETIRED'; rehash(retired);
    assert.deepEqual(eligibleKnowledgeCards(retired, access()), []);
    const unreviewed = reviewed(); unreviewed.reviewers = []; rehash(unreviewed);
    assert.throws(() => eligibleKnowledgeCards(unreviewed, access()), /REVIEW_REQUIRED/);
    for (const release of ['2.3.9', '2.5.0', '3.0.0']) {
      assert.deepEqual(eligibleKnowledgeCards(reviewed(), { ...access(), release }), []);
    }
    for (const now of ['2026-09-01T00:00:00Z', '2026-12-27T00:00:00+07:00']) {
      assert.deepEqual(eligibleKnowledgeCards(reviewed(), { ...access(), now: new Date(now) }), []);
    }
  });

  it('filters audience, actual permissions, features and exact capability before semantic selection', () => {
    assert.deepEqual(offeredKnowledgeMetadata(reviewed(), { ...access(), member: false }), []);
    assert.deepEqual(offeredKnowledgeMetadata(reviewed(), { ...access(), permissions: [] }), []);
    const featureOff = offeredKnowledgeMetadata(reviewed(), { ...access(), featureKeys: [] });
    assert.ok(featureOff.every((row) => row.id.startsWith('reimbursement.')));
    const readUnavailable = offeredKnowledgeMetadata(reviewed(), { ...access(), capabilities: [] });
    assert.ok(!readUnavailable.some((row) => row.id === 'expense.find'));
    assert.ok(readUnavailable.some((row) => row.id === 'expense.status'), 'concept guidance remains available');
  });

  it('offers bounded metadata without loading bodies, tenant facts or private records into the selector', () => {
    const rows = offeredKnowledgeMetadata(reviewed(), access());
    assert.equal(rows.length, PRODUCT_HELP_PACK.cards.length);
    assert.deepEqual(Object.keys(rows[0]!).sort(), ['id', 'questions', 'summary', 'title', 'version']);
    assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= 12 * 1024);
  });

  it('selects exact IDs only and rejects invented, duplicated and overflowing selections as a whole', () => {
    const rows = offeredKnowledgeMetadata(reviewed(), access());
    assert.deepEqual(parseSelectedKnowledgeCardIds(['expense.status'], rows), ['expense.status']);
    assert.deepEqual(parseSelectedKnowledgeCardIds([], rows), []);
    for (const invalid of ['expense.status', ['missing'], ['expense.status', 'expense.status'], rows.slice(0, 6).map((r) => r.id), [1], { selected: ['expense.status'] }]) {
      assert.equal(parseSelectedKnowledgeCardIds(invalid, rows), undefined);
    }
  });

  it('rechecks changed permissions, feature state and expiry before exposing the selected body', () => {
    const pack = reviewed(); const selection = ['expense.status'];
    assert.ok(parseSelectedKnowledgeCardIds(selection, offeredKnowledgeMetadata(pack, access())));
    assert.equal(renderApprovedKnowledge(pack, selection, { ...access(), permissions: [] }, 'company-A'), null);
    assert.equal(renderApprovedKnowledge(pack, selection, { ...access(), featureKeys: [] }, 'company-A'), null);
    assert.equal(renderApprovedKnowledge(pack, selection, { ...access(), now: new Date(pack.reviewDueAt) }, 'company-A'), null);
  });

  it('returns the full reviewed body and citations from the manifest, never model-authored links', () => {
    const pack = reviewed();
    const answer = renderApprovedKnowledge(pack, ['expense.status'], access(), 'company-A')!;
    const card = pack.cards.find((entry) => entry.id === 'expense.status')!;
    assert.equal(answer.replyText, `${card.title}\n${card.body}`);
    assert.equal(answer.sourceRefs[0]!.permissionChecked, true);
    assert.equal(answer.webLinks[0]!.path, '/companies/company-A/user-guide/expenses#overview');
    assert.equal(renderApprovedKnowledge(pack, ['expense.status'], access(), '../other'), null);
    assert.equal(renderApprovedKnowledge(pack, ['https://evil.invalid'], access(), 'company-A'), null);
  });

  it('rejects tampered bodies/source URLs and invalid immutable hashes', () => {
    const bodyChanged = reviewed(); bodyChanged.cards[0]!.body += ' injected change';
    assert.throws(() => validateKnowledgePack(bodyChanged), /CARD_HASH_MISMATCH/);
    const urlChanged = reviewed(); urlChanged.cards[0]!.sourceURL = 'https://unreviewed.invalid/'; rehash(urlChanged);
    assert.throws(() => validateKnowledgePack(urlChanged), /INVALID_SOURCE/);
    const changedWindow = reviewed(); changedWindow.reviewDueAt = '2026-12-01T00:00:00Z';
    assert.throws(() => validateKnowledgePack(changedWindow), /PACK_HASH_MISMATCH/);
  });

  it('rejects pack/card/metadata overflow rather than silently truncating instructions or citations', () => {
    const tooMany = reviewed(); tooMany.cards = Array.from({ length: 65 }, () => tooMany.cards[0]!); rehash(tooMany);
    assert.throws(() => validateKnowledgePack(tooMany), /CARD_LIMIT/);
    const body = reviewed(); body.cards[0]!.body = 'ก'.repeat(1366); rehash(body);
    assert.throws(() => validateKnowledgePack(body), /BODY_LIMIT/);
    const metadata = reviewed(); metadata.cards[0]!.summary = 'ก'.repeat(4097); rehash(metadata);
    assert.throws(() => validateKnowledgePack(metadata), /METADATA_LIMIT/);
  });
});
