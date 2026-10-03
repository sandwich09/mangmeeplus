import type { MangmeeTone } from '@/common/components/mangmee';
import { THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';

export const GUIDE_PERMISSION_REQUEST = `ใช้ตารางนี้บอก${THAI_SYSTEM_ROLE_NAMES.OWNER}ว่าต้องการสิทธิ์ใดเพิ่ม`;
export const GUIDE_MISSING_MENU_HELP = `ถ้าเมนูเปิดใช้แล้วแต่คุณไม่มีสิทธิ์ ให้แจ้ง${THAI_SYSTEM_ROLE_NAMES.OWNER}ตามตารางสิทธิ์ ถ้าเมนูยังไม่ได้เปิดใช้ ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}ตรวจแพ็กเกจหรือติดต่อทีมงาน`;

/** A link out of the manual and into the screen it describes. */
export type GuideLink = { label: string; href: string };

/**
 * Blocks are the whole vocabulary of a guide page. Content files pick from these instead of
 * writing markup, so every manual reads the same way and one styling fix covers all of them.
 */
export type GuideBlock =
  | { kind: 'items'; items: { title: string; detail: string; link?: GuideLink }[] }
  | { kind: 'steps'; steps: { title: string; detail: string }[] }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'note'; tone: 'info' | 'warn'; title: string; detail: string }
  | { kind: 'faq'; items: { question: string; answer: string }[] };

export type GuideSection = {
  /** Anchor id, also the key of the jump link at the top of the page. */
  id: string;
  title: string;
  summary?: string;
  /** Key into WORKSPACE_ICON_NODES. */
  iconKey: string;
  tone: MangmeeTone;
  blocks: GuideBlock[];
};

export type UserGuide = {
  key: string;
  /** Sidebar/menu label — kept identical to the source document title. */
  title: string;
  eyebrow: string;
  description: string;
  /** Where in the app this manual is about, shown as the first call to action. */
  primaryLink?: GuideLink;
  sections: GuideSection[];
};
