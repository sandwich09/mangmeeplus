import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExpensesGuide } from './expenses-guide.content';
import { MANUAL_ENTRY_NOT_ENABLED_GUIDE_NOTE, withManualEntryNotEnabled } from './expenses-guide-manual-entry';

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
