import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExpensesGuide } from './expenses-guide.content';
import { MANUAL_ENTRY_NOT_ENABLED_GUIDE_NOTE, withManualEntryNotEnabled } from './expenses-guide-manual-entry';
import type { UserGuide } from './user-guide.model';

const OWNER = ['expense.read', 'expense.read_own', 'expense.receipt.upload', 'expense.create', 'expense.category.manage', 'expense.evidence.read'];
const MANUAL_HREF = '/companies/co/expenses/manual';

function linkHrefs(guide: ReturnType<typeof buildExpensesGuide>): string[] {
  return guide.sections.flatMap((section) => section.blocks)
    .flatMap((block) => (block.kind === 'items' ? block.items.map((item) => item.link?.href) : []))
    .filter((href): href is string => Boolean(href));
}

// manual-expense-web-entry-flag spec §9.3. `expenses-guide.content.ts` is pinned by hash for the
// LINE answer pack, so the guide is changed here, on its result, and the pinned file stays as it is.
describe('expenses guide when the company does not show the manual-entry menu', () => {
  it('takes the shortcut to the manual page away and says why at the top of that section', () => {
    const source = buildExpensesGuide('co', OWNER);
    assert.ok(linkHrefs(source).includes(MANUAL_HREF), 'the source guide offers the shortcut to an owner');

    const guide = withManualEntryNotEnabled(source);
    assert.ok(!linkHrefs(guide).includes(MANUAL_HREF));
    const manual = guide.sections.find((section) => section.id === 'manual')!;
    assert.deepEqual(manual.blocks[0], { kind: 'note', tone: 'info', ...MANUAL_ENTRY_NOT_ENABLED_GUIDE_NOTE });
    // The spec's sentence, read top to bottom: the heading of the note, then its line.
    assert.equal(`${MANUAL_ENTRY_NOT_ENABLED_GUIDE_NOTE.title} ${MANUAL_ENTRY_NOT_ENABLED_GUIDE_NOTE.detail}`,
      'เมนูนี้ไม่ได้เปิดใช้สำหรับร้านของคุณ ขั้นตอนในหัวข้อนี้จึงยังใช้ไม่ได้ในขณะนี้');
    assert.notEqual(MANUAL_ENTRY_NOT_ENABLED_GUIDE_NOTE.title, manual.title, 'the note does not repeat the heading it sits under');
  });

  it('keeps the section, its steps and every other section and shortcut exactly as they were', () => {
    const source = buildExpensesGuide('co', OWNER);
    const guide = withManualEntryNotEnabled(source);

    assert.deepEqual(guide.sections.map((section) => section.id), source.sections.map((section) => section.id));
    assert.equal(guide.sections.length, 10);
    for (const [index, section] of source.sections.entries()) {
      if (section.id !== 'manual') assert.deepEqual(guide.sections[index], section, section.id);
    }
    // The manual section loses only the link: titles and details of its steps are untouched.
    const before = source.sections.find((section) => section.id === 'manual')!;
    const after = guide.sections.find((section) => section.id === 'manual')!;
    assert.equal(after.blocks.length, before.blocks.length + 1);
    const strip = (block: (typeof before.blocks)[number]) => (block.kind === 'items'
      ? { ...block, items: block.items.map(({ link: _link, ...item }) => item) } : block);
    assert.deepEqual(after.blocks.slice(1), before.blocks.map(strip));
    assert.deepEqual(linkHrefs(guide), linkHrefs(source).filter((href) => href !== MANUAL_HREF));
    assert.deepEqual(guide.primaryLink, source.primaryLink);
  });

  it('does not change the guide it was given, and still adds the note for a reader who had no shortcut', () => {
    const source = buildExpensesGuide('co', OWNER);
    const snapshot = JSON.stringify(source);
    withManualEntryNotEnabled(source);
    assert.equal(JSON.stringify(source), snapshot);

    const reader = withManualEntryNotEnabled(buildExpensesGuide('co', ['expense.read_own']));
    assert.equal(reader.sections.find((section) => section.id === 'manual')!.blocks[0]!.kind, 'note');
  });
});

/** Every sentence a reader of the guide can see, keyed by its section and its own first words. */
function sentences(guide: UserGuide): Map<string, string> {
  const out = new Map<string, string>();
  for (const section of guide.sections) {
    out.set(`${section.id}:#title`, section.title);
    if (section.summary) out.set(`${section.id}:#summary`, section.summary);
    for (const block of section.blocks) {
      if (block.kind === 'items') for (const item of block.items) out.set(`${section.id}:${item.title}`, `${item.title} ${item.detail}`);
      if (block.kind === 'steps') for (const step of block.steps) out.set(`${section.id}:${step.title}`, `${step.title} ${step.detail}`);
      if (block.kind === 'table') for (const row of block.rows) out.set(`${section.id}:${row[0]}`, row.join(' '));
      if (block.kind === 'note') out.set(`${section.id}:${block.title}`, `${block.title} ${block.detail}`);
      if (block.kind === 'faq') for (const item of block.items) out.set(`${section.id}:${item.question}`, `${item.question} ${item.answer}`);
    }
  }
  return out;
}

// After this release the manual-entry web menu is not shown in any shop until the system admin
// switches it on for that shop, so the pinned guide is read by shops that have the menu and shops
// that do not. Every sentence must be true for both (the owner's rule).
describe('expenses guide sentences about manual entry, for a shop that shows the menu and one that does not', () => {
  const NAMES_MANUAL_ENTRY = /บันทึก(?:ค่าใช้จ่าย)?ด้วยมือ|บันทึกเอง/;
  const CONDITION = 'เปิดใช้สำหรับร้านของคุณ';
  /** Sentences that name manual entry and are true either way without the condition, and why. */
  const TRUE_EITHER_WAY: Record<string, string> = {
    'submenus:บันทึกด้วยมือ': 'names the submenu and what it does; the section summary says when it shows',
    'list:วันที่ / ช่องทาง': 'the channel label of records already saved, which they keep',
    'manual:#title': 'the section heading; while the menu is not shown the note sits right under it',
    'permissions:บันทึกค่าใช้จ่ายด้วยมือ': 'the right it takes, which the menu setting does not change',
  };
  /** The upload page's link into the substitute-receipt flow, which no menu setting hides: it names who sees it. */
  const SUBSTITUTE_LINK = ['upload:กรณีไม่มีใบเสร็จ', 'ผู้มีสิทธิ์สร้างและตรวจสอบค่าใช้จ่าย'] as const;
  const guide = buildExpensesGuide('co', OWNER);
  const all = sentences(guide);

  it('says when manual entry is there wherever it offers it, or is true either way for a reason written down', () => {
    const offering = [...all].filter(([key, text]) => NAMES_MANUAL_ENTRY.test(text) || key === 'manual:#summary');
    assert.ok(offering.length >= 8, 'the scan finds the sentences it is about');
    for (const [key, text] of offering) {
      if (key in TRUE_EITHER_WAY) continue;
      if (key === SUBSTITUTE_LINK[0]) assert.ok(text.includes(SUBSTITUTE_LINK[1]), `${key}: ${text}`);
      else assert.ok(text.includes(CONDITION), `${key}: ${text}`);
    }
    for (const key of [...Object.keys(TRUE_EITHER_WAY), SUBSTITUTE_LINK[0]]) assert.ok(all.has(key), `no such sentence any more: ${key}`);
  });

  // A folded section shows two lines of its summary, so on a phone the end of a long one is cut off:
  // the condition of the manual-entry section comes first, where it is always read.
  it('puts the condition first in the manual-entry section\'s summary, which a folded section clamps', () => {
    assert.ok(all.get('manual:#summary')!.indexOf(CONDITION) < 20, all.get('manual:#summary'));
  });

  it('explains a missing manual-entry menu by the shop setting, not only by the reader\'s rights', () => {
    assert.ok(all.get('submenus:#summary')!.includes(CONDITION), 'the summary of the list of submenus');
    assert.ok(all.get('faq:ไม่พบเมนูย่อยบางรายการในแถบเมนูซ้าย')!.includes(CONDITION), 'the answer about a missing submenu');
  });
});
