import type { LineQuickReplyItem, LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { DRAFT_UPDATE_CANCEL_COMMAND, DRAFT_UPDATE_CONFIRM_COMMAND } from './line-draft-update-card.logic';
import { FEATURE_CATALOG } from '@watchdog-bms/contracts';

/**
 * P10-L. The exact words on a button ARE the command, so the label and the matcher can never drift:
 * both read these. Every one of them is also typeable — the quota card's follow-up text tells a shop
 * owner to type "ขอเปลี่ยนแพ็กเกจ", and that has to keep working.
 */
export const PACKAGE_CHANGE_COMMAND = 'ขอเปลี่ยนแพ็กเกจ';
export const VIEW_PACKAGES_COMMAND = 'โปรโมชั่น';
export const EMPLOYEE_DOOR_COMMAND = 'ฉันเป็นพนักงาน';
export const STAFF_CONTACT_COMMAND = 'ติดต่อเจ้าหน้าที่';
/**
 * The way BACK from a support pause (line-support-request-spec-th §2.4). Without it the only exit
 * from "a human is handling this" was waiting 24 hours — the customer had no button and no words.
 *
 * Two spellings because both are natural and both are printed in the reply the pause sends; exact
 * whole-string matches like every other command here, so a sentence that merely quotes one (a
 * pasted instruction, an OCR'd photo caption) cannot resume the assistant on the customer's behalf.
 */
export const RESUME_AI_COMMAND = 'คุยกับ AI ต่อ';
export const RESUME_AI_ALT_COMMAND = 'ให้ AI ตอบ';
export const PROFILE_GUARD_COMMAND = 'ใส่เลย';
export const PROFILE_GUARD_LATER_COMMAND = 'ไว้ก่อน';
/**
 * The synthetic text a `follow` event travels as (G-03). It is a menu command on purpose: the
 * buffer routes anything `staffMenuCommand` recognises down the command lane, so a greeting is
 * answered on its own instead of being merged into whatever the customer types next.
 */
export const LINE_FOLLOW_EVENT_TEXT = 'เพิ่มเพื่อนใหม่';

export type StaffMenuContext = {
  displayName: string;
  roleLabel: string;
  branchScopeLabel: string;
  permissions: string[];
  /** Feature keys this company has switched on, from `loadEntitledFeatureKeys`. `null` is that
   *  loader's legacy fail-open sentinel (a company with no entitlement rows at all) and shows
   *  every menu the caller's permissions already allow. */
  entitledFeatureKeys: ReadonlySet<string> | null;
  webBaseUrl?: string;
  companyId: string;
  isOwner?: boolean;
};

export type CompanyPickerItem = {
  companyId: string;
  companyName: string;
};

export type CompanyContextCard = {
  companyName: string;
  displayName: string;
  roleLabels: string[];
};

/**
 * [label, sent text, any-of permissions, any-of feature keys].
 *
 * The feature column names the module that OWNS the data the answer reads, so a company that never
 * switched that module on never sees a button whose only possible reply is "no data" or a refusal.
 * Submenu keys are listed directly where one exists, because `evaluateEntitledFeatureKeys` already
 * expands a parent's submenus — checking the submenu is the precise gate, not a stricter one.
 */
const QUERY_ACTIONS = [
  // Owner decision 2026-08-15: today's number is read off the dashboard, so `dashboard.read` is the
  // honest permission. `sales.order.read` used to sit here too and was removed — it exists in no
  // registry, no role, and no tool, so it never gated anything. The button waits for the sales
  // feature through the entitlement column instead.
  ['ยอดขายวันนี้', 'ดูยอดขายวันนี้', ['dashboard.read'], ['sales_documents']],
  ['คิว/นัดวันนี้', 'ดูคิววันนี้', ['crm.booking.read'], ['crm.bookings']],
  ['แชทค้างตอบ', 'ดูแชทค้างตอบ', ['crm.inbox.read'], ['crm.inbox']],
  ['ค่าใช้จ่ายเดือนนี้', 'ดูค่าใช้จ่ายเดือนนี้', ['expense.read'], ['expenses']],
  ['รายงานการเงิน', 'ดูรายงานการเงิน', ['report.finance.read', 'ledger.read'], ['reports', 'double_entry_ledger']],
  ['ใบสั่งซื้อ (PO)', 'ดูใบสั่งซื้อ', ['procurement.purchase_order.read', 'procurement.purchase_order.read_related'], ['procurement.purchase_orders']],
] as const;

const hasAny = (permissions: Set<string>, required: readonly string[]) => required.some((key) => permissions.has(key));

const hasFeature = (entitled: ReadonlySet<string> | null, required: readonly string[]) =>
  entitled === null || required.some((key) => entitled.has(key));

const messageAction = (label: string, text = label) => ({ type: 'action' as const, action: { type: 'message' as const, label, text } });

export function buildStaffCompletionQuickReply(
  context: Pick<StaffMenuContext, 'permissions' | 'entitledFeatureKeys' | 'isOwner'>,
): NonNullable<LineReplyMessage['quickReply']> {
  const permissions = new Set(context.permissions);
  const entitled = context.entitledFeatureKeys;
  const items: LineQuickReplyItem[] = QUERY_ACTIONS
    .filter(([, , required, features]) => hasAny(permissions, required) && hasFeature(entitled, features))
    .map(([label, text]) => messageAction(label, text));
  items.push(messageAction('📊 ถามข้อมูล', 'ถามข้อมูล'));
  if (context.isOwner) items.push(messageAction('🏢 บริษัทของฉัน', '/companies'));
  // Offered only when the approval card behind it can render at least one real queue, so the
  // button and the card it opens can never disagree about what this company runs.
  if (availableApprovalSurfaces(permissions, entitled).length > 0) {
    items.push(messageAction('✅ รายการรออนุมัติ', 'รายการรออนุมัติ'));
  }
  if (hasAny(permissions, ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create'])
    && hasFeature(entitled, ['expenses.upload'])) {
    items.push({ type: 'action', action: { type: 'camera', label: '📷 ถ่ายใบเสร็จ' } } as const);
  }
  return { items: items.slice(0, 13) };
}

export function buildStaffMainMenu(context: StaffMenuContext): LineReplyMessage {
  const quickReply = buildStaffCompletionQuickReply(context);
  const items = quickReply.items;
  const displayName = boundedLabel(context.displayName, 'พนักงาน');
  const roleLabel = boundedLabel(context.roleLabel, 'พนักงาน');
  const scopeLabel = context.branchScopeLabel;
  return {
    type: 'flex',
    altText: `สวัสดีค่ะ ${displayName} 👋\nตำแหน่ง ${roleLabel} · ดูข้อมูลได้ ${scopeLabel} · เข้าถึง ${items.length} เมนู\nเมนูด้านล่างแสดงเฉพาะสิ่งที่บริษัทเปิดใช้และตำแหน่งคุณมีสิทธิ์เข้าถึง`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '14px', contents: [
          { type: 'text', wrap: true, size: 'md', contents: [
            { type: 'span', text: 'สวัสดีค่ะ ' },
            { type: 'span', text: displayName, weight: 'bold' },
            { type: 'span', text: ' 👋' },
          ] },
          { type: 'text', wrap: true, size: 'md', contents: [
            { type: 'span', text: 'ตำแหน่ง ' },
            { type: 'span', text: roleLabel, weight: 'bold' },
            { type: 'span', text: ' · ดูข้อมูลได้ ' },
            { type: 'span', text: scopeLabel, weight: 'bold' },
            { type: 'span', text: ' · เข้าถึง ' },
            { type: 'span', text: `${items.length} เมนู`, weight: 'bold' },
          ] },
          { type: 'text', text: 'เมนูด้านล่างแสดงเฉพาะสิ่งที่บริษัทเปิดใช้และตำแหน่งคุณมีสิทธิ์เข้าถึง', wrap: true, size: 'xs', color: '#667085' },
        ],
      },
      styles: { body: { backgroundColor: '#FFFFFF' } },
    },
    quickReply,
  };
}

const boundedLabel = (value: string, fallback: string) => (value.trim() || fallback).slice(0, 80);

export function buildCompanyContextMessage(context: CompanyContextCard): LineReplyMessage {
  const companyName = boundedLabel(context.companyName, 'ไม่ระบุบริษัท');
  const displayName = boundedLabel(context.displayName, 'ผู้ใช้งาน');
  const roleLabel = boundedLabel(context.roleLabels.filter(Boolean).join(' · '), 'พนักงาน');
  return {
    type: 'flex',
    altText: `บริษัทของฉัน: ${companyName} · คุณ${displayName} · ${roleLabel}`,
    contents: {
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px', contents: [
        { type: 'text', text: 'บริษัทของฉัน', weight: 'bold', size: 'lg', color: '#101828' },
        { type: 'text', text: `🏢 ${companyName}`, weight: 'bold', size: 'md', color: '#101828', wrap: true },
        { type: 'text', text: `👤 คุณ${displayName}`, size: 'sm', color: '#475467', wrap: true },
        { type: 'text', text: `💼 ${roleLabel}`, size: 'sm', color: '#475467', wrap: true },
      ] },
    },
  };
}

const serviceBubble = (labels: string[], index: number, total: number): Record<string, unknown> => ({
  type: 'bubble', size: 'kilo',
  body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
    { type: 'text', text: 'บริการที่บริษัทของคุณเปิดใช้', weight: 'bold', size: 'md', color: '#101828', wrap: true },
    ...(total > 1 ? [{ type: 'text', text: `หน้า ${index + 1}/${total}`, size: 'xs', color: '#667085' }] : []),
    ...labels.map((label) => ({ type: 'text', text: `✓ ${label}`, size: 'sm', color: '#475467', wrap: true })),
  ] },
});

export function buildServiceEntitlementMessage(entitled: ReadonlySet<string> | null): LineReplyMessage {
  const labels = FEATURE_CATALOG
    .filter((feature) => feature.sellable && (entitled === null || entitled.has(feature.key)))
    .map((feature) => feature.labelTh);
  if (labels.length === 0) {
    return {
      type: 'flex',
      altText: 'บริษัทนี้ยังไม่มีบริการที่เปิดใช้งานผ่าน LINE',
      contents: {
        type: 'bubble', size: 'kilo',
        body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
          { type: 'text', text: 'บริการที่บริษัทของคุณเปิดใช้', weight: 'bold', size: 'md', color: '#101828', wrap: true },
          { type: 'text', text: 'บริษัทนี้ยังไม่มีบริการที่เปิดใช้งานผ่าน LINE', size: 'sm', color: '#667085', wrap: true },
        ] },
      },
    };
  }
  const pages = Array.from({ length: Math.ceil(labels.length / 8) }, (_, index) => labels.slice(index * 8, index * 8 + 8));
  const bubbles = pages.map((page, index) => serviceBubble(page, index, pages.length));
  return {
    type: 'flex',
    altText: `บริการที่บริษัทของคุณเปิดใช้: ${labels.join(', ')}`.slice(0, 400),
    contents: bubbles.length === 1 ? bubbles[0]! : { type: 'carousel', contents: bubbles },
  };
}

/** Owner design 2026-08-27 (rich menu v2 ver2): the Promotion tile shows the package poster.
 *  The poster is a committed web asset so LINE fetches it over existing HTTPS hosting; when the
 *  base URL is unset (misconfigured env) the card still delivers its text body, never a broken
 *  image reference. */
export function buildPromotionCard(assetBaseUrl: string | undefined): LineReplyMessage {
  const imageUrl = assetBaseUrl
    ? `${assetBaseUrl.replace(/\/+$/, '')}/assets/line/mangmeeplus-package-promo-1080x1350.png`
    : undefined;
  return {
    type: 'flex',
    altText: 'แพ็กเกจมั่งมี Plus — เริ่มต้น 249.-/เดือน ทดลองใช้ PRO ฟรี',
    contents: {
      type: 'bubble', size: 'mega',
      ...(imageUrl ? {
        hero: {
          type: 'image', url: imageUrl, size: 'full', aspectRatio: '4:5', aspectMode: 'cover',
          action: { type: 'uri', label: 'ดูแพ็กเกจ', uri: 'https://official.mangmeeplus.com/' },
        },
      } : {}),
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
        { type: 'text', text: '🎁 Package ที่เหมาะกับร้านคุณ', weight: 'bold', size: 'md', color: '#101828', wrap: true },
        { type: 'text', text: 'เริ่มต้น 249.-/เดือน และเริ่มด้วยแพ็กเกจ PRO “ทดลองใช้ฟรี” ได้เลยค่ะ', size: 'sm', color: '#475467', wrap: true },
      ] },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'button', style: 'primary', color: '#22C55E', action: { type: 'uri', label: 'ทดลองใช้ฟรี', uri: 'https://official.mangmeeplus.com/' } },
        // Spec §3.7: the promotion card is a PULL, so the one thing it must let the reader do is
        // ask — the request lands in the admin queue rather than changing anything by itself.
        { type: 'button', style: 'secondary', action: { type: 'message', label: PACKAGE_CHANGE_COMMAND, text: PACKAGE_CHANGE_COMMAND } },
        { type: 'button', style: 'secondary', action: { type: 'message', label: 'คุยกับทีมงาน', text: 'ติดต่อเรา' } },
      ] },
    },
  };
}

/**
 * Owner 2026-08-27: a "ทำอะไรได้บ้าง" question answered by the model advertised features that do
 * not exist. A capability question now gets the curated card below — deterministic, zero model
 * calls, only the real menu functions. Bounded to SHORT messages, and the generic "ใช้ยังไง"
 * stems additionally require the system itself as the subject, so a real business question that
 * merely contains a stem (e.g. "ใบกำกับภาษีใช้ยังไง") still takes the full AI route.
 */
export function isCapabilityQuestion(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0 || normalized.length > 40) return false;
  if (['ทำอะไรได้', 'ทำไรได้', 'ช่วยอะไรได้', 'ช่วยไรได้', 'มีฟีเจอร์อะไร'].some((stem) => normalized.includes(stem))) return true;
  return ['ใช้ยังไง', 'ใช้งานยังไง'].some((stem) => normalized.includes(stem))
    && ['มั่งมี', 'ระบบ', 'แอป', 'แอพ', 'ที่นี่', 'เมนู'].some((subject) => normalized.includes(subject));
}

/** The six REAL functions, matching rich menu v2 ver2 — nothing aspirational belongs here. */
export function buildCapabilityCard(): LineReplyMessage {
  return {
    type: 'flex',
    altText: 'น้องมั่งมีช่วยอะไรได้บ้าง',
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px', contents: [
        { type: 'text', text: 'น้องมั่งมีช่วยอะไรได้บ้าง 💚', weight: 'bold', size: 'lg', color: '#101828', wrap: true },
        { type: 'text', text: '🧾 ถ่ายใบเสร็จ — ส่งรูปใบเสร็จ ระบบอ่านและบันทึกค่าใช้จ่ายให้', size: 'sm', color: '#475467', wrap: true },
        { type: 'text', text: '📊 ถามข้อมูลธุรกิจ — เช่น “ยอดขายวันนี้” “ค่าใช้จ่ายเดือนนี้” “สรุปบัญชี”', size: 'sm', color: '#475467', wrap: true },
        { type: 'text', text: '💬 คุยกับน้องมั่งมี — ปรึกษาธุรกิจ บัญชี ภาษีเบื้องต้น หรือคุยเล่นก็ได้', size: 'sm', color: '#475467', wrap: true },
        { type: 'text', text: '🏢 บริษัทของฉัน — ดูหรือสลับบริษัท (พิมพ์ /companies)', size: 'sm', color: '#475467', wrap: true },
        { type: 'text', text: '🎁 โปรโมชั่น — ดูแพ็กเกจและทดลองใช้ฟรี (พิมพ์ โปรโมชั่น)', size: 'sm', color: '#475467', wrap: true },
        { type: 'text', text: '☎️ ติดต่อเรา — คุยกับทีมงานตัวจริง', size: 'sm', color: '#475467', wrap: true },
        { type: 'text', text: 'พิมพ์ “เมนูหลัก” เพื่อเรียกเมนูได้ทุกเมื่อค่ะ', size: 'xs', color: '#667085', wrap: true, margin: 'md' },
      ] },
    },
  };
}

export function buildContactCard(): LineReplyMessage {
  return {
    type: 'flex',
    altText: 'ติดต่อมั่งมี Plus: contact@mangmeeplus.com โทร 098-256-5628',
    contents: {
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px', contents: [
        { type: 'text', text: 'ติดต่อมั่งมี Plus', weight: 'bold', size: 'lg', color: '#101828' },
        { type: 'text', text: '✉️ contact@mangmeeplus.com', size: 'sm', color: '#475467', wrap: true },
        { type: 'text', text: '📱 098-256-5628', weight: 'bold', size: 'md', color: '#101828' },
      ] },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'button', style: 'secondary', action: { type: 'clipboard', label: 'คัดลอกอีเมล', clipboardText: 'contact@mangmeeplus.com' } },
        { type: 'button', style: 'secondary', action: { type: 'uri', label: 'โทร 098-256-5628', uri: 'tel:0982565628' } },
        { type: 'button', style: 'primary', color: '#22C55E', action: { type: 'uri', label: 'เว็บไซต์อย่างเป็นทางการ', uri: 'https://official.mangmeeplus.com/' } },
        // P10-L §7. The rich menu's contact tile sends "ติดต่อเรา", which lands here — so without
        // this button the keyword that actually reaches a person was typing-only, and nobody could
        // discover it. Chat, not a phone call, is the channel these customers already live in.
        { type: 'button', style: 'secondary', action: { type: 'message', label: STAFF_CONTACT_COMMAND, text: STAFF_CONTACT_COMMAND } },
      ] },
    },
  };
}

function companyBubble(company: CompanyPickerItem, selectionNumber: number, currentCompanyId?: string): Record<string, unknown> {
  const current = company.companyId === currentCompanyId;
  return {
    type: 'bubble',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', contents: [
        { type: 'text', text: `🏢 บริษัท ${selectionNumber}`, size: 'sm', color: '#667085' },
        { type: 'text', text: boundedLabel(company.companyName, 'ไม่ระบุบริษัท'), weight: 'bold', size: 'lg', color: '#101828', wrap: true },
        ...(current ? [{ type: 'text', text: '✓ ใช้งานอยู่', size: 'sm', color: '#16A34A', weight: 'bold' }] : []),
        ...(!current ? [{ type: 'text', text: `ตอบ ${selectionNumber} หรือกดปุ่มด้านล่าง`, size: 'sm', color: '#667085', wrap: true }] : []),
      ],
    },
    ...(!current ? {
      footer: {
        type: 'box', layout: 'vertical', contents: [
          { type: 'button', style: 'primary', color: '#22C55E', action: { type: 'message', label: 'เลือกบริษัทนี้', text: `/company ${company.companyId}` } },
        ],
      },
    } : {}),
  };
}

/** LINE Flex carousels allow at most 12 bubbles. Eleven company bubbles plus one navigation
 * bubble keep every company reachable without silently dropping a name. */
export function buildCompanyPickerMessage(companies: CompanyPickerItem[], currentCompanyId?: string, requestedPage = 1): LineReplyMessage {
  if (companies.length === 0) return { type: 'text', text: 'ไม่พบบริษัทที่ใช้งานได้ในขณะนี้' };

  const current = companies.find((company) => company.companyId === currentCompanyId);
  const ordered = current ? [current, ...companies.filter((company) => company.companyId !== current.companyId)] : companies;
  const pageSize = companies.length > 12 ? 11 : 12;
  const pageCount = Math.ceil(ordered.length / pageSize);
  const page = Math.max(1, Math.min(requestedPage, pageCount));
  const visible = ordered.slice((page - 1) * pageSize, page * pageSize);
  const bubbles = visible.map((company) => companyBubble(company, companies.findIndex((item) => item.companyId === company.companyId) + 1, currentCompanyId));
  if (pageCount > 1) bubbles.push({
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      { type: 'text', text: `บริษัทของฉัน · หน้า ${page}/${pageCount}`, weight: 'bold', size: 'md', color: '#101828', wrap: true },
      { type: 'text', text: `แสดง ${visible.length} จาก ${companies.length} บริษัท`, size: 'sm', color: '#667085' },
    ] },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      ...(page > 1 ? [{ type: 'button', style: 'secondary', action: { type: 'message', label: 'หน้าก่อนหน้า', text: `/companies page ${page - 1}` } }] : []),
      ...(page < pageCount ? [{ type: 'button', style: 'primary', color: '#22C55E', action: { type: 'message', label: 'หน้าถัดไป', text: `/companies page ${page + 1}` } }] : []),
    ] },
  });

  return {
    type: 'flex',
    altText: 'เลือกบริษัทที่ต้องการใช้งาน',
    contents: bubbles.length === 1 ? bubbles[0]! : { type: 'carousel', contents: bubbles },
  };
}

export function buildStaffQueryMenu(context: StaffMenuContext): LineReplyMessage {
  const permissions = new Set(context.permissions);
  const items = QUERY_ACTIONS
    .filter(([, , required, features]) => hasAny(permissions, required) && hasFeature(context.entitledFeatureKeys, features))
    .map(([label, text]) => messageAction(label, text));
  items.push(messageAction('« เมนูหลัก', 'เมนูหลัก'));
  return {
    type: 'text',
    text: 'อยากดูข้อมูลส่วนไหนดีคะ 📊\nแสดงเฉพาะเมนูที่บริษัทเปิดใช้และตำแหน่งคุณมีสิทธิ์เข้าถึง',
    quickReply: { items },
  };
}

export function buildReceiptCapturePrompt(_context: StaffMenuContext): LineReplyMessage {
  return {
    type: 'flex',
    altText: 'แนบรูปใบเสร็จเข้าระบบ',
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: [
        { type: 'text', text: 'แนบรูปใบเสร็จเข้าระบบ', weight: 'bold', size: 'md', color: '#101828' },
        { type: 'text', text: 'กด “แนบรูปใบเสร็จ” หรือ “เปิดกล้อง” ด้านล่าง แล้วส่งภาพให้เห็นข้อมูลครบทั้งใบค่ะ 🖼\nระบบจะบันทึกเป็นรายการรอตรวจสอบ ไม่อนุมัติหรือชำระเงินอัตโนมัติ', wrap: true, size: 'sm', color: '#667085' },
      ] },
      styles: { body: { backgroundColor: '#FFFFFF' } },
    },
    quickReply: { items: [
      { type: 'action', action: { type: 'cameraRoll', label: '🖼 แนบรูปใบเสร็จ' } },
      { type: 'action', action: { type: 'camera', label: '📷 เปิดกล้อง' } },
      messageAction('« เมนูหลัก', 'เมนูหลัก'),
    ] },
  };
}

/** One button per real approval queue the member can act on. Ordered as listed. */
const APPROVAL_SURFACES = [
  {
    key: 'reimbursement',
    label: 'คำขอเบิกเงิน',
    permissions: ['reimbursement.approve'],
    path: 'reimbursements?tab=approvals',
    features: ['reimbursement'],
  },
  {
    key: 'procurement',
    label: 'ใบขอซื้อ/ใบสั่งซื้อ',
    permissions: ['procurement.purchase_request.approve', 'procurement.purchase_order.approve'],
    path: 'procurement',
    features: ['procurement.purchase_requests', 'procurement.purchase_orders'],
  },
] as const;

export type ApprovalSurfaceKey = (typeof APPROVAL_SURFACES)[number]['key'];

/** What the approver has waiting: `total` is the whole queue, `items` the display lines the card
 *  may show. A key left out means that queue could not be read — the card then links out without a
 *  count instead of implying zero. */
export type PendingApprovalSnapshot = Partial<Record<ApprovalSurfaceKey, { total: number; items: string[] }>>;

/** LINE shows the shortlist; the web app stays the place the approval is actually made. */
export const PENDING_APPROVAL_ITEM_LIMIT = 5;

/** The single source both the quick-reply button and the card itself read. Hoisted, so the quick
 *  reply above can call it. */
function availableApprovalSurfaces(permissions: Set<string>, entitled: ReadonlySet<string> | null) {
  return APPROVAL_SURFACES.filter((surface) =>
    hasAny(permissions, surface.permissions) && hasFeature(entitled, surface.features));
}

/** The queues worth querying before the card is built. */
export function availableApprovalSurfaceKeys(
  context: Pick<StaffMenuContext, 'permissions' | 'entitledFeatureKeys'>,
): ApprovalSurfaceKey[] {
  return availableApprovalSurfaces(new Set(context.permissions), context.entitledFeatureKeys)
    .map((surface) => surface.key);
}

export function buildPendingApprovalCard(context: StaffMenuContext, pending: PendingApprovalSnapshot = {}): LineReplyMessage {
  const base = context.webBaseUrl?.replace(/\/$/, '');
  const permissions = new Set(context.permissions);
  const companySegment = `/companies/${encodeURIComponent(context.companyId)}/`;
  const surfaces = availableApprovalSurfaces(permissions, context.entitledFeatureKeys);
  const buttons = base
    ? surfaces.map((surface) => ({
      type: 'button', style: 'primary', color: '#12B76A',
      action: { type: 'uri', label: surface.label, uri: `${base}${companySegment}${surface.path}` },
    }))
    : [];

  const counted = surfaces.filter((surface) => pending[surface.key]);
  const total = counted.reduce((sum, surface) => sum + pending[surface.key]!.total, 0);
  const lines: Record<string, unknown>[] = [];
  let listed = 0;
  for (const surface of counted) {
    const queue = pending[surface.key]!;
    if (queue.total === 0) continue;
    lines.push({ type: 'text', text: `${surface.label} (${queue.total})`, weight: 'bold', size: 'sm', color: '#101828', margin: 'md', wrap: true });
    for (const item of queue.items.slice(0, PENDING_APPROVAL_ITEM_LIMIT - listed)) {
      lines.push({ type: 'text', text: `• ${item}`, size: 'sm', color: '#475467', wrap: true });
      listed += 1;
    }
  }

  const summary = counted.length === 0
    ? 'เปิดรายการจริงในเว็บเพื่อดูรายละเอียด ตรวจเพดานวงเงิน และยืนยันอย่างปลอดภัย'
    : total === 0
      ? 'ตอนนี้ไม่มีรายการรออนุมัติค่ะ'
      : `มี ${total} รายการรอคุณอนุมัติ`;
  const closing = total > 0
    ? listed < total
      ? `แสดง ${listed} จาก ${total} รายการ · เปิดในเว็บเพื่อดูทั้งหมดและยืนยันอย่างปลอดภัย`
      : 'เปิดในเว็บเพื่อดูรายละเอียดและยืนยันอย่างปลอดภัย'
    : undefined;

  return {
    type: 'flex',
    altText: counted.length === 0 ? 'รายการรออนุมัติ' : `รายการรออนุมัติ ${total} รายการ`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
        { type: 'text', text: '✅ รายการรออนุมัติ', weight: 'bold', size: 'lg', color: '#101828' },
        { type: 'text', text: summary, wrap: true, color: '#667085', size: 'sm' },
        ...lines,
        ...(closing ? [{ type: 'text', text: closing, wrap: true, color: '#667085', size: 'xs', margin: 'md' }] : []),
      ] },
      ...(buttons.length > 0 ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } } : {}),
    },
  };
}

export type StaffMenuCommand =
  | 'main' | 'query' | 'approval' | 'receipt' | 'services' | 'contact' | 'talk' | 'promotion'
  // P10-L §3.7/§7. The four commands the LINE-first flow answers. All exact whole-string matches,
  // because every one of them is printed on a button — a customer never has to spell them.
  | 'package_change' | 'employee' | 'staff_contact' | 'profile_guard' | 'profile_guard_later'
  // §2.4 delta: the customer's own way out of the support pause.
  | 'resume_ai'
  // S-4 (draft-control spec §5.4): the two buttons on the draft-edit confirm card. Typed answers
  // work too, which is the point of SEC-04 — a postback may do nothing a message could not.
  | 'draft_update_confirm' | 'draft_update_cancel'
  | 'follow';

export function staffMenuCommand(text: string): StaffMenuCommand | null {
  const normalized = text.trim().replace(/[📊✅📷🎁]/gu, '').trim();
  if (normalized === 'เมนูหลัก') return 'main';
  if (normalized === 'ถามข้อมูล') return 'query';
  if (normalized === 'รายการรออนุมัติ') return 'approval';
  if (normalized === 'ถ่ายใบเสร็จ') return 'receipt';
  if (normalized === 'บริการของเรา') return 'services';
  if (normalized === 'ติดต่อเรา') return 'contact';
  if (normalized === 'คุยกับน้องมั่งมี') return 'talk';
  if (normalized === PACKAGE_CHANGE_COMMAND) return 'package_change';
  if (normalized === EMPLOYEE_DOOR_COMMAND) return 'employee';
  if (normalized === STAFF_CONTACT_COMMAND) return 'staff_contact';
  if (normalized === RESUME_AI_COMMAND || normalized === RESUME_AI_ALT_COMMAND) return 'resume_ai';
  if (normalized === PROFILE_GUARD_COMMAND) return 'profile_guard';
  if (normalized === PROFILE_GUARD_LATER_COMMAND) return 'profile_guard_later';
  if (normalized === DRAFT_UPDATE_CONFIRM_COMMAND) return 'draft_update_confirm';
  if (normalized === DRAFT_UPDATE_CANCEL_COMMAND) return 'draft_update_cancel';
  if (normalized === LINE_FOLLOW_EVENT_TEXT) return 'follow';
  if (normalized === 'โปรโมชั่น' || normalized === 'แพ็กเกจ') return 'promotion';
  return null;
}

/**
 * P10-L G-04 / SEC-04. A postback carries INTENT and nothing else: a bare action name, no company
 * id, no request id, no state. Each one resolves to a command the text lane already answers, so the
 * single place that re-checks membership, role and company state stays the only place that decides
 * anything — a forged `data` value can therefore reach no further than a typed message could.
 */
const POSTBACK_ACTIONS: Readonly<Record<string, string>> = {
  'line-rich-talk': 'คุยกับน้องมั่งมี',
  'package-change': PACKAGE_CHANGE_COMMAND,
  'profile-guard': PROFILE_GUARD_COMMAND,
  'profile-guard-later': PROFILE_GUARD_LATER_COMMAND,
  // S-4: the confirm/cancel buttons carry an intent and no ids. The server re-derives which
  // preview they answer from the chat, so a forged or replayed `data` reaches nothing.
  'draft-update-confirm': DRAFT_UPDATE_CONFIRM_COMMAND,
  'draft-update-cancel': DRAFT_UPDATE_CANCEL_COMMAND,
};

/** `action=<name>&…`; unknown or absent actions answer null so the event is dropped, not guessed. */
export function linePostbackCommandText(data: string | undefined): string | null {
  if (!data) return null;
  let action: string | null;
  try {
    action = new URLSearchParams(data).get('action');
  } catch {
    return null;
  }
  return (action && POSTBACK_ACTIONS[action]) ?? null;
}
