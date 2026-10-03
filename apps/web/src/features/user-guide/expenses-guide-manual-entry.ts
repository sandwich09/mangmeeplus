import type { UserGuide } from './user-guide.model';

// manual-expense-web-entry-flag spec §9.3. `expenses-guide.content.ts` is pinned by hash for the LINE
// answer pack (approved-product-help.ts), so the guide of a company that does not show the
// manual-entry menu is made here, from the RESULT of `buildExpensesGuide`, and that file is untouched.

/**
 * One sentence of the spec, in the note's two slots: what is so, then what follows from it. The
 * note sits right under the section's own heading, so repeating "บันทึกด้วยมือ" as its title would
 * say nothing. True for a shop that was never switched on and for one that was switched off again:
 * the web cannot tell them apart.
 */
export const MANUAL_ENTRY_NOT_ENABLED_GUIDE_NOTE = {
  title: 'เมนูนี้ไม่ได้เปิดใช้สำหรับร้านของคุณ',
  detail: 'ขั้นตอนในหัวข้อนี้จึงยังใช้ไม่ได้ในขณะนี้',
} as const;

const MANUAL_SECTION_ID = 'manual';
const isManualPageLink = (href: string) => href.endsWith('/expenses/manual');

/**
 * The same guide with the shortcut to the manual page removed and a note at the top of the
 * "บันทึกด้วยมือ" section. The section, its steps and every other section stay: the guide refers to
 * its sections by number and to "เมนูย่อยทั้ง 8 รายการ".
 */
export function withManualEntryNotEnabled(guide: UserGuide): UserGuide {
  return {
    ...guide,
    sections: guide.sections.map((section) => (section.id !== MANUAL_SECTION_ID ? section : {
      ...section,
      blocks: [
        { kind: 'note' as const, tone: 'info' as const, ...MANUAL_ENTRY_NOT_ENABLED_GUIDE_NOTE },
        ...section.blocks.map((block) => (block.kind !== 'items' ? block : {
          ...block,
          items: block.items.map(({ link, ...item }) => (link && !isManualPageLink(link.href) ? { ...item, link } : item)),
        })),
      ],
    })),
  };
}
