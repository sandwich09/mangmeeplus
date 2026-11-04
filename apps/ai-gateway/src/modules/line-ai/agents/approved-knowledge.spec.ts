import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXPENSE_CORRECTION_WORDS } from '@watchdog-bms/contracts';
import {
  eligibleKnowledgeCards, knowledgeCardHash, knowledgePackHash, offeredKnowledgeMetadata,
  parseSelectedKnowledgeCardIds, renderApprovedKnowledge, validateKnowledgePack,
  type KnowledgeAccess, type ProductKnowledgePack,
} from './approved-knowledge';
import { activeProductHelpPack, PRODUCT_HELP_PACK, PRODUCT_HELP_V6_PACK } from './approved-product-help';
import { PLAIN_WORDS_HELP_DRAFTS } from './product-help-draft-cards';

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
  it('LINE-HELP-APPROVE bounds relevant owner and staff offers before the model sees them', () => {
    const pack = activeProductHelpPack();
    const owner = { ...access(), permissions: [...new Set(pack.cards.flatMap(card => [...card.permissionAnyOf, ...card.requiredPermissions]))],
      featureKeys: null, capabilities: pack.cards.flatMap(card => card.requiredCapabilities) };
    for (const [message, wanted] of [['เปิดร้านยังไง', 'shop.open'], ['50 ทวิ คืออะไร', 'wht.certificate-meaning'], ['ขอคืนเงินค่าแพ็ก', 'package.cancellation']]) {
      const rows = offeredKnowledgeMetadata(pack, owner, message);
      assert.ok(rows.some(row => row.id === wanted), message);
      assert.ok(rows.length <= 12, message);
      assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= 12 * 1024, message);
      assert.deepEqual(rows, offeredKnowledgeMetadata(pack, owner, message));
    }
    const staff = { ...owner, permissions: ['line.ai.query', 'expense.read_own'] };
    const rows = offeredKnowledgeMetadata(pack, staff, 'เปิดร้านยังไง');
    for (const id of ['shop.open', 'staff.invite', 'staff.roles', 'package.buy']) assert.ok(!rows.some(row => row.id === id), id);
    const fallback = offeredKnowledgeMetadata(pack, owner, 'xyzxyz');
    assert.deepEqual(fallback.map(row => row.id), eligibleKnowledgeCards(pack, owner).slice(0, 12).map(card => card.id));
    assert.ok(Buffer.byteLength(JSON.stringify(fallback)) <= 12 * 1024);
    const outsideOffer = eligibleKnowledgeCards(pack, owner).find(card => !fallback.some(row => row.id === card.id))!;
    assert.ok(renderApprovedKnowledge(pack, [outsideOffer.id], owner, 'company-A'), 'rendering rechecks the full eligible set');
    assert.deepEqual(offeredKnowledgeMetadata(pack, owner, 'เปิด ร้าน ยัง ไง'), offeredKnowledgeMetadata(pack, owner, 'เปิดร้านยังไง'));
  });

  it('LINE-HELP-APPROVE keeps the byte cap even when a valid card has oversized metadata', () => {
    const pack = structuredClone(activeProductHelpPack());
    pack.cards = pack.cards.slice(0, 2);
    pack.cards[0]!.title = 'ก'.repeat(5000); rehash(pack);
    const rows = offeredKnowledgeMetadata(pack, access(), '');
    assert.deepEqual(rows.map(row => row.id), [pack.cards[1]!.id]);
    assert.ok(Buffer.byteLength(JSON.stringify(rows)) <= 12 * 1024);
  });

  it('validates bounded curated bodies against the exact checked-in manual source hashes', () => {
    validateKnowledgePack(PRODUCT_HELP_PACK);
    assert.equal(PRODUCT_HELP_PACK.status, 'APPROVED');
    assert.deepEqual(PRODUCT_HELP_PACK.reviewers, ['repository-ai-source-code-review:claude-opus-5-5:2026-10-13']);
    assert.equal(PRODUCT_HELP_PACK.version, 4);
    assert.equal(PRODUCT_HELP_PACK.cards.length, 12, 'refresh the existing pack without adding cards');
    assert.equal(PRODUCT_HELP_PACK.effectiveTo, '2026-12-27T00:00:00+07:00');
    assert.equal(PRODUCT_HELP_PACK.reviewDueAt, PRODUCT_HELP_PACK.effectiveTo);
    assert.equal(PRODUCT_HELP_PACK.contentHash, 'd900b41d31287179551c270635e1333d56432b86627ce7f5b7ad3bfd2571ab14');
    const root = resolve(__dirname, '../../../../../..');
    for (const card of PRODUCT_HELP_PACK.cards) {
      assert.equal(card.version, /\/reimbursement-guide\.content\.ts$/.test(card.sourceFile) ? 4 : /\/expenses-guide\.content\.ts$/.test(card.sourceFile) ? 3 : /\/substitute-receipt-guide\.content\.ts$/.test(card.sourceFile) ? 2 : 1, card.id);
      const served = activeProductHelpPack().cards.find(current => current.id === card.id)!;
      assert.equal(createHash('sha256').update(readFileSync(resolve(root, served.sourceFile))).digest('hex'), served.sourceHash, served.sourceFile);
      const guide = card.sourceURL.split('/user-guide/')[1]!.split('#')[0]!;
      assert.ok(readFileSync(resolve(root, `apps/web/app/(workspace)/companies/[companyId]/user-guide/${guide}/page.tsx`)), 'citation page exists');
    }
  });

  it('explains conditional correction after confirmation to readers without promising edit rights', () => {
    const card = PRODUCT_HELP_PACK.cards.find((entry) => entry.id === 'expense.draft')!;
    const answer = renderApprovedKnowledge(PRODUCT_HELP_PACK, [card.id], { ...access(), permissions: ['expense.read_own'] }, 'company-A')!;
    assert.ok(answer, 'read-only members can ask about correction');
    assert.match(answer.replyText, new RegExp(`ผู้มีสิทธิ์กด “${EXPENSE_CORRECTION_WORDS.reopen}” ได้เมื่อเอกสารเปิดแก้ไขได้`));
    assert.match(answer.replyText, /กลับไปตรวจสอบโดยใช้เลขเอกสารเดิม/);
    assert.match(answer.replyText, /หากเปิดแก้ไขไม่ได้.*เหตุผล.*ผู้ที่ต้องติดต่อ/);
    assert.doesNotMatch(answer.replyText, /เมื่อยืนยันแล้วไม่ใช่ร่างที่แก้ได้ตามปกติ/);
    assert.equal(answer.webLinks[0]!.path, '/companies/company-A/user-guide/expenses#overview');
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

  // The web menu for manual entry is not shown in a shop until the system admin switches it on, and a
  // reader may hold no right to record at all: a card that names manual entry says what it depends on.
  it('never offers manual entry as if every shop shows that menu and every reader may record', () => {
    const offering = PRODUCT_HELP_PACK.cards.filter((card) => /บันทึก(?:ค่าใช้จ่าย)?ด้วยมือ|บันทึกเอง/.test(card.body));
    assert.ok(offering.some((card) => card.id === 'expense.start'));
    for (const card of offering) assert.match(card.body, /ตามช่องทางที่เปิดใช้สำหรับร้านของคุณและสิทธิ์ที่คุณมี/, card.id);
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


it('PWS-HELP publishes the exact owner-approved v7 words and retains immutable v6 history', () => {
  const pack = activeProductHelpPack();
  validateKnowledgePack(pack);
  assert.equal(pack.version, 7);
  assert.equal(pack.contentHash, 'fb42b47fae1b91cbf04d59c518236fe67ad7e89cba8cb5c9e7f0f899f63676c0');
  assert.deepEqual(pack.reviewers, ['owner-review:2026-11-04:chat:ตามแนะนำ']);
  assert.equal(PRODUCT_HELP_V6_PACK.contentHash, '0bab85e0afa9cc83d0ab71af7d12f2110f7749f7461532c8c159711c81c008c0');
  validateKnowledgePack(PRODUCT_HELP_V6_PACK);
  const approved = [
  {
    "id": "expense.vat-display",
    "body": "ยอด VAT บนรายการคือยอดที่อ่านได้จากเอกสาร ยังไม่ได้แปลว่าใช้ตอนยื่นภาษีได้ค่ะ"
  },
  {
    "id": "expense.export",
    "body": "ตรวจรายการแล้วส่งออกไฟล์บนเว็บเพื่อให้ผู้ทำบัญชีตรวจต่อค่ะ"
  },
  {
    "id": "wht.calculation",
    "body": "ใช้ยอดก่อน VAT คูณอัตราของ “จ่ายค่าอะไร” ที่เลือกค่ะ เลือกให้ตรงกับรายการก่อนนะคะ"
  },
  {
    "id": "expense.vat-credit",
    "body": "ขึ้นกับเอกสารและเงื่อนไขของรายการค่ะ ดูคำตอบ “ใช้ VAT ตอนยื่นภาษี” ในรายการนั้น ถ้ามีตัวจริงแต่ยังไม่มีรูป เลือก “มีตัวจริง ยังไม่ได้แนบรูป” แล้วแนบทีหลังได้ค่ะ"
  }
];
  const root = resolve(__dirname, '../../../../../..');
  const screenSources = ['packages/contracts/src/expenses.ts', 'apps/web/src/common/i18n/workspace-dictionary.ts', 'apps/web/src/features/tax/WithholdingPage.tsx', 'apps/web/src/features/expenses/ExpensesPages.tsx']
    .map(path => readFileSync(resolve(root, path), 'utf8')).join('\n');
  for (const expected of approved) {
    const card = pack.cards.find(card => card.id === expected.id)!;
    assert.equal(card.body, expected.body, card.id);
    const permitted = { ...access(), permissions: card.permissionAnyOf, featureKeys: null };
    const rendered = renderApprovedKnowledge(pack, [card.id], permitted, 'company-A')!;
    assert.equal(rendered.replyText, `${card.title}\n${expected.body}`);
    assert.deepEqual(rendered.webLinks, renderApprovedKnowledge(PRODUCT_HELP_V6_PACK, [card.id], permitted, 'company-A')!.webLinks.map(link => ({ ...link, label: card.title })));
    const draft = PLAIN_WORDS_HELP_DRAFTS.find(draft => draft.channel === 'LINE' && draft.id === card.id)!;
    assert.equal(card.body, draft.body);
    for (const label of card.body.matchAll(/“([^”]+)”/gu)) assert.ok(screenSources.includes(label[1]!), `Missing screen label: ${label[1]}`);
    assert.equal(renderApprovedKnowledge(pack, [card.id], { ...access(), permissions: [], featureKeys: [], capabilities: [] }, 'company-A'), null);
    const prior = PRODUCT_HELP_V6_PACK.cards.find(prior => prior.id === card.id)!;
    assert.deepEqual([card.permissionAnyOf, card.requiredPermissions, card.featureKeys, card.requiredCapabilities],
      [prior.permissionAnyOf, prior.requiredPermissions, prior.featureKeys, prior.requiredCapabilities]);
  }
  const vat = pack.cards.find(card => card.id === 'expense.vat-credit')!;
  assert.equal(vat.title, 'VAT นี้ใช้ตอนยื่นภาษีได้ไหม');
  const priorVat = PRODUCT_HELP_V6_PACK.cards.find(card => card.id === vat.id)!;
  for (const question of [...priorVat.questions, priorVat.title, vat.title]) assert.ok(vat.questions.includes(question), question);
  assert.ok(vat.questions.some(question => question.includes('ภาษีซื้อ')));
  for (const words of ['ภาษีซื้อ', 'สิทธิภาษีซื้อ', vat.title]) {
    assert.ok(offeredKnowledgeMetadata(pack, { ...access(), permissions: ['expense.review'] }, words).some(card => card.id === vat.id), words);
  }
  // Item 3 is the Q3 data answer; the reviewed generic fallback stays intact.
  assert.equal(pack.cards.find(card => card.id === 'wht.pnd53-due')!.body, PRODUCT_HELP_V6_PACK.cards.find(card => card.id === 'wht.pnd53-due')!.body);
  for (const card of pack.cards) {
    const prior = PRODUCT_HELP_V6_PACK.cards.find(prior => prior.id === card.id)!;
    if (!approved.some(value => value.id === card.id)) assert.equal(card.body, prior.body, card.id);
    assert.equal(createHash('sha256').update(readFileSync(resolve(root, card.sourceFile))).digest('hex'), card.sourceHash, card.sourceFile);
  }
});
