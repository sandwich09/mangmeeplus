import type { LineQuickReplyItem, LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { DRAFT_UPDATE_CANCEL_COMMAND, DRAFT_UPDATE_CONFIRM_COMMAND } from './line-draft-update-card.logic';
import { FEATURE_CATALOG, scrubRecordText } from '@watchdog-bms/contracts';

/**
 * P10-L. The exact words on a button ARE the command, so the label and the matcher can never drift:
 * both read these. Every one of them is also typeable — the quota card's follow-up text tells a shop
 * owner to type "ขอเปลี่ยนแพ็กเกจ", and that has to keep working.
 */
export const PACKAGE_CHANGE_COMMAND = 'ขอเปลี่ยนแพ็กเกจ';
export const VIEW_PACKAGES_COMMAND = 'โปรโมชั่น';
export const EMPLOYEE_DOOR_COMMAND = 'ฉันเป็นพนักงาน';
export const STAFF_CONTACT_COMMAND = 'ติดต่อเจ้าหน้าที่';
/** The staff LINE OA (Owner 2026-09-29). A BUTTON opens it; the typed command keeps its inbox route. */
export const STAFF_OA_URL = 'https://lin.ee/UU9pbOI';
/**
 * G19 (purchase-without-setup spec §12/RV32): the promotion card's "ask the team" is a CALLBACK request,
 * not a package-change request and not "ติดต่อเจ้าหน้าที่" — it must not silence the assistant for 24 h.
 * Travels as a postback so the words never enter the chat as something the customer typed.
 */
export const PACKAGE_CALLBACK_COMMAND = 'ให้ทีมงานติดต่อกลับ';
export const PACKAGE_CALLBACK_POSTBACK = 'action=package-callback';
/**
 * The way BACK from a support pause (line-support-request-spec-th §2.4, §2.2 delta รอบ 6 ข้อ 6).
 * Without it the only exit from "a human is handling this" was waiting 24 hours — the customer had
 * no button and no words.
 *
 * Owner 2026-09-06: the way back is the "คุยกับน้องมั่งมี" tile itself, tapped or typed, and every
 * paused reply prints these words. The tile and the resume command are therefore ONE string and one
 * `talk` command — matched once, and routed by pause state in the use case — rather than two
 * matches racing for the same text.
 */
export const RESUME_AI_COMMAND = 'คุยกับน้องมั่งมี';
/**
 * The spellings people still type: the two the replies used to print, and the two short forms the
 * Owner named. Whole-string matches like every other command here, so a sentence that merely quotes
 * one (a pasted instruction, an OCR'd photo caption) cannot resume the assistant on the customer's
 * behalf. The Latin "AI" is matched case-insensitively — see `menuCommandKey`, and UAT 2026-09-06.
 */
export const RESUME_AI_ALIASES = ['คุยกับ AI ต่อ', 'ให้ AI ตอบ', 'คุยกับ AI', 'คุยกับมั่งมี'] as const;
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
  /**
   * The already-minted one-tap link that opens the web app on THIS company (P12-3b `/l/<token>`).
   * Absent — which is every caller while `LINE_WEB_HANDOFF_ENABLED` is off, and every company whose
   * mint failed — renders the bubble exactly as it rendered before this feature: half a picker is
   * worse than the one that always worked.
   */
  webUrl?: string;
  /** R-C8: "ยังไม่มีแพ็กเกจ" / "หมดอายุ" for a locked shop only; absent keeps an ACTIVE bubble's bytes. */
  stateLabel?: string;
};

/**
 * Owner 2026-09-06: "มี 2 ปุ่ม ปุ่มเลือก อันนี้ทำงานเหมือนเดิม … อีกปุ่มคือสลับบริษัทและพาไปเว็บไซต์
 * ตามบริษัทนั้น". Constants so the wording is one line to change, and so the label matcher and the
 * button can never drift apart. Every label stays inside 12 Thai grapheme clusters, which is what
 * LINE's `sm` button renders without an ellipsis.
 */
export const COMPANY_PICKER_SELECT_LABEL = 'เลือกบริษัทนี้';
export const COMPANY_PICKER_OPEN_WEB_LABEL = 'เปิดเว็บบริษัทนี้';
/** Says what the second button does that the first does not — the switch comes free with it. */
export const COMPANY_PICKER_OPEN_WEB_HINT = 'กดเปิดเว็บ ระบบจะสลับบริษัทในไลน์ให้ด้วยค่ะ';

export type CompanyContextCard = {
  companyName: string;
  displayName: string;
  roleLabels: string[];
  /**
   * "เปิดร้านใหม่": the SAME central LIFF signup page the door card opens, so an owner who is already
   * linked can start a second shop — `submit-line-signup.use-case.ts` attaches it to the account the
   * LINE identity already proves. The caller builds it from this environment's own config and passes
   * `undefined` wherever self-service signup is closed, so nothing here is environment-specific and
   * no id, company or token ever travels in the URL (LINE-ONBOARD-01).
   */
  newShopSignupUrl?: string;
  /**
   * Owner 2026-09-06: "ปุ่มเปิดร้านใหม่โผล่ให้ STAFF ผ่าน /companies => staff ไม่ควรเห็น ถ้าเขาจะเปิดร้านเอง
   * ต้องผ่าน promotion หากอยู่ในมุมมองพนักงาน". Opening a shop is a shop-owner action, so the door above
   * is gated on the viewer's role in the company THIS card is about — someone who owns their own shop
   * and works at another sees the door on one card and the โปรโมชั่น pointer on the other. Spec §3.1
   * built the "ฉันเป็นพนักงาน" door for the same trap ("พนักงานเผลอสมัครร้านซ้ำ") at the stranger end.
   *
   * Absent means employee: a caller that forgets the flag withholds the door rather than opening it.
   */
  isOwner?: boolean;
  /**
   * The shop named on the application this LINE account still has travelling, or `undefined` when
   * it has none. UAT 2026-09-06 "สมัครแล้วแต่บริษัทหาย": a repeat trial always queues for review
   * (§3.3), so the owner who had just used the button above came back to this card and found no
   * trace of the shop they applied for. The card says where the request is, and the door above is
   * withheld while it is open — the LIFF form could only answer `line_signup_already_pending`.
   *
   * Free text an applicant typed, so the card scrubs it like every other customer-supplied value.
   */
  pendingSignupName?: string;
  /**
   * Owner 2026-09-06: *"เจ้าของที่มีบริษัทเดียวจะไม่เห็นการ์ดเลือกบริษัท อยากให้การ์ดบริษัทเดียวมีปุ่มเปิดเว็บด้วย"*.
   * The picker carrying `เปิดเว็บบริษัทนี้` is only sent to a member of more than one company, so a
   * single-shop owner never saw that button at all. Same already-minted `/l/<token>` link, for the
   * company THIS card is about. Absent — the handoff feature off, or a mint that failed — renders
   * the card exactly as it rendered before, the same rule `CompanyPickerItem.webUrl` follows.
   */
  openWebUrl?: string;
  /** R-C8: the same lock wording the picker shows; absent for an ACTIVE shop. */
  stateLabel?: string;
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
  // Every state that keeps an application open also fences the applicant out of filing another one,
  // `PROVISIONING_FAILED` included, so all of them get the one answer `buildSignupStatusCard` gives
  // — "รอทีมงานตรวจสอบ". Two surfaces saying different things about one request is the bug this fixes.
  const shop = scrubRecordText(context.pendingSignupName, 60);
  const pendingLine = context.pendingSignupName === undefined ? undefined
    : `🕒 คำขอเปิดร้าน${shop ? ` «${shop}»` : 'ใหม่'} รอทีมงานตรวจสอบ ปกติภายในวันทำการ`;
  // Exactly one of these two, and only where the environment actually opens a door: the owner gets
  // it, the employee gets the words for the route they already have in the menu. An open request
  // silences both — the LIFF form behind either one could only answer `line_signup_already_pending`.
  // The command name comes from the constant the tile and the matcher read, so the sentence cannot
  // send an employee to words that stopped working.
  const door = Boolean(context.newShopSignupUrl) && !pendingLine;
  const promotionLine = door && !context.isOwner
    ? `💡 อยากเปิดร้านของตัวเอง กดปุ่ม ${VIEW_PACKAGES_COMMAND} ในเมนูได้เลยค่ะ`
    : undefined;
  // Opening the web on the company you are already in is not a shop-owner action — the web enforces
  // its own permissions — so this one is for every member, and the door above keeps its own gate.
  // No `COMPANY_PICKER_OPEN_WEB_HINT` here: the picker's hint explains a SWITCH, and this card is
  // already about this company.
  const buttons = [
    ...(context.openWebUrl ? [{ type: 'button', style: 'secondary', action: { type: 'uri', label: COMPANY_PICKER_OPEN_WEB_LABEL, uri: context.openWebUrl } }] : []),
    ...(door && context.isOwner ? [{ type: 'button', style: 'primary', color: '#22C55E', action: { type: 'uri', label: 'เปิดร้านใหม่', uri: context.newShopSignupUrl } }] : []),
  ];
  return {
    type: 'flex',
    altText: `บริษัทของฉัน: ${companyName} · คุณ${displayName} · ${roleLabel}${pendingLine ? `\n${pendingLine}` : ''}`,
    contents: {
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px', contents: [
        { type: 'text', text: 'บริษัทของฉัน', weight: 'bold', size: 'lg', color: '#101828' },
        { type: 'text', text: `🏢 ${companyName}`, weight: 'bold', size: 'md', color: '#101828', wrap: true },
        ...(context.stateLabel ? [{ type: 'text', text: `🔒 ${context.stateLabel}`, size: 'sm', color: '#B42318' }] : []),
        { type: 'text', text: `👤 คุณ${displayName}`, size: 'sm', color: '#475467', wrap: true },
        { type: 'text', text: `💼 ${roleLabel}`, size: 'sm', color: '#475467', wrap: true },
        ...(pendingLine ? [{ type: 'text', text: pendingLine, size: 'sm', color: '#475467', wrap: true }] : []),
        ...(promotionLine ? [{ type: 'text', text: promotionLine, size: 'sm', color: '#475467', wrap: true }] : []),
      ] },
      // `spacing` only where there is a gap to space, so the one-button card stays byte-identical
      // to the one shipped today — the same rule the picker's footer follows.
      ...(buttons.length > 0
        ? { footer: { type: 'box', layout: 'vertical', ...(buttons.length > 1 ? { spacing: 'sm' } : {}), contents: buttons } }
        : {}),
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

/**
 * Public pre-sales card. Keep the obsolete PRO-free poster out of the live reply.
 *
 * Owner 2026-09-21: the tile leads INTO the app now, so the main button follows whoever tapped it.
 * `url` is the owner's own package page (the one-tap handoff link, or the plain tenant page when no
 * token could be minted) or the stranger's LIFF signup form; an employee is given neither, because
 * choosing the package belongs to the shop owner — the same rule the package-change reply states.
 * An absent `url` simply drops that button, the fail-open every card here uses for an unusable URL.
 */
export function buildPromotionCard(audience: 'owner' | 'employee' | 'stranger', url?: string): LineReplyMessage {
  const stranger = audience === 'stranger';
  return {
    type: 'flex',
    altText: 'แพ็กเกจมั่งมี Plus',
    contents: {
      type: 'bubble', size: 'mega',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
        { type: 'text', text: '🎁 แพ็กเกจที่เหมาะกับร้านคุณ', weight: 'bold', size: 'md', color: '#101828', wrap: true },
        { type: 'text', text: 'รายเดือน 249 / 499 / 999 บาท และแพ็กเกจธุรกิจ 1,999 บาท ที่เพิ่มเอกสารภาษี ภ.ง.ด.53 และ 50 ทวิ เลือกและชำระในแอปได้เองค่ะ', size: 'sm', color: '#475467', wrap: true },
        ...(audience === 'employee'
          ? [{ type: 'text', text: 'เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจเป็นคนเลือกแพ็กเกจให้ร้านนะคะ', size: 'sm', color: '#667085', wrap: true }]
          : []),
      ] },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        ...(url ? [{ type: 'button', style: 'primary', color: '#22C55E', action: { type: 'uri', label: stranger ? 'เปิดร้านใหม่' : 'เลือกแพ็กเกจ', uri: url } }] : []),
        { type: 'button', style: 'secondary', action: { type: 'uri', label: stranger ? 'ดูแพ็กเกจบนเว็บ' : 'ดูรายละเอียดบนเว็บ', uri: 'https://official.mangmeeplus.com/' } },
        // Spec §3.7: the promotion card is a PULL, so the one thing it must let the reader do is
        // ask — the request lands in the support inbox as a callback rather than changing anything
        // by itself. A stranger has no shop yet, so that ask only exists once they have one.
        // G19: a callback request that files a support row without pausing the assistant (RV32).
        ...(stranger ? [] : [{ type: 'button', style: 'secondary', action: { type: 'postback', label: PACKAGE_CALLBACK_COMMAND, data: PACKAGE_CALLBACK_POSTBACK, displayText: PACKAGE_CALLBACK_COMMAND } }]),
        { type: 'button', style: 'secondary', action: { type: 'message', label: 'คุยกับทีมงาน', text: 'ติดต่อเรา' } },
      ] },
    },
  };
}

/**
 * The "ขอเปลี่ยนแพ็กเกจ" answer for whoever may buy (review 2026-09-29): its link as ONE button, never
 * a raw URL in the chat. `url` is the lane's one-tap `/l/<token>` or the plain package page; the
 * reply exit adds the external-browser escape to the button as to any other link.
 */
export function buildPackageReviewCard(shopName: string, url: string): LineReplyMessage {
  const title = `📦 ${boundedLabel(shopName, 'ร้านของคุณ')}`;
  const note = 'เลือกแพ็กเกจ ตรวจสอบการชำระเงิน และเปิดใบเสร็จได้ที่หน้าแพ็กเกจ (เปิดในเบราว์เซอร์ให้อัตโนมัติ) '
    + 'ตรวจสอบราคาและยืนยันบนเว็บก่อนชำระเงินนะคะ';
  return {
    type: 'flex',
    altText: `${title} ${note}`.slice(0, 400),
    contents: {
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
        { type: 'text', text: title, weight: 'bold', size: 'md', color: '#101828', wrap: true },
        { type: 'text', text: note, size: 'sm', color: '#475467', wrap: true },
      ] },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: '#22C55E', action: { type: 'uri', label: 'เลือกแพ็กเกจ', uri: url } },
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
  if (/^(?:เพิ่ง(?:เริ่ม)?ใช้(?:ครั้งแรก)?|เพิ่งสมัคร|ใช้ครั้งแรก)(?:ต้อง)?(?:ทำยังไง|เริ่มตรงไหน|ใช้งานยังไง)(?:ดี)?(?:ครับ|ค่ะ|คะ)?[?？]?$/u.test(normalized.replace(/\s+/gu, ''))) return true;
  if (['ทำอะไรได้', 'ทำไรได้', 'ช่วยอะไรได้', 'ช่วยไรได้', 'มีฟีเจอร์อะไร'].some((stem) => normalized.includes(stem))) return true;
  if (TEACH_REQUEST.test(normalized) && !TUTORING_EXPENSE.test(normalized)) return true;
  return ['ใช้ยังไง', 'ใช้งานยังไง'].some((stem) => normalized.includes(stem))
    && ['มั่งมี', 'ระบบ', 'แอป', 'แอพ', 'ที่นี่', 'เมนู'].some((subject) => normalized.includes(subject));
}

/** Owner 2026-09-06 ("ตกลง"): "สอนวิธีใช้หน่อย" is the same capability question asked as a request,
 *  so it joins the lane above. Bare "สอน" is an everyday tutoring EXPENSE noun (ค่าสอนพิเศษ,
 *  โรงเรียนสอนขับรถ, สอนงานพนักงานใหม่), so a match needs the REQUEST form: สอน glued to a usage
 *  object (สอน[การ|วิธี|วิธีการ]ใช้) or, across a short subject/filler run, to a polite imperative
 *  particle (สอน…หน่อย, สอน…ที + ครับ/ค่ะ/นะ or end of message). "ที" must be followed by ค/น or the
 *  end so "สอนที่บ้าน" and "สอนทีเดียว" stay out. */
const TEACH_REQUEST = /สอน(?:(?:การ|วิธี|วิธีการ)?ใช้|[ก-๙\s]{0,8}(?:หน่อย|ที(?:$|[คน])))/;
/** …and the expense noun keeps its own veto, because a bill CAN carry a request particle
 *  ("ขอบิลค่าสอนหน่อย"). A DIGIT anywhere disqualifies too: a tutoring expense always names an
 *  amount ("ค่าสอนพิเศษ 500"), a teach request never does. Scoped to this branch only — the
 *  "ทำอะไรได้บ้าง" and "ใช้ยังไง" lanes above keep their existing behaviour. */
const TUTORING_EXPENSE = /\d|ค่าเรียน|(?:ค่า|บิล|ใบเสร็จ|จ้าง)สอน/;

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
        { type: 'text', text: '🎁 โปรโมชั่น — ดูแพ็กเกจและราคา (พิมพ์ โปรโมชั่น)', size: 'sm', color: '#475467', wrap: true },
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
        // Owner 2026-09-29: add the staff OA and chat there; typed support commands keep their route.
        { type: 'button', style: 'secondary', action: { type: 'uri', label: STAFF_CONTACT_COMMAND, uri: STAFF_OA_URL } },
      ] },
    },
  };
}

function companyBubble(company: CompanyPickerItem, selectionNumber: number, currentCompanyId?: string): Record<string, unknown> {
  const current = company.companyId === currentCompanyId;
  // Two ways in, in the order they were asked for: switch the chat only (unchanged, and still
  // typeable as a number), or switch AND open the web on that company in one tap. The current
  // company keeps having nothing to select, so it gets the web button alone.
  const buttons = [
    ...(!current ? [{ type: 'button', style: 'primary', color: '#22C55E', action: { type: 'message', label: COMPANY_PICKER_SELECT_LABEL, text: `/company ${company.companyId}` } }] : []),
    ...(company.webUrl ? [{ type: 'button', style: 'secondary', action: { type: 'uri', label: COMPANY_PICKER_OPEN_WEB_LABEL, uri: company.webUrl } }] : []),
  ];
  return {
    type: 'bubble',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', contents: [
        { type: 'text', text: `🏢 บริษัท ${selectionNumber}`, size: 'sm', color: '#667085' },
        { type: 'text', text: boundedLabel(company.companyName, 'ไม่ระบุบริษัท'), weight: 'bold', size: 'lg', color: '#101828', wrap: true },
        ...(company.stateLabel ? [{ type: 'text', text: `🔒 ${company.stateLabel}`, size: 'sm', color: '#B42318' }] : []),
        // "ใช้งานอยู่" beside a lock chip contradicts it; the chat is merely on this shop.
        ...(current ? [{ type: 'text', text: company.stateLabel ? '✓ เลือกอยู่' : '✓ ใช้งานอยู่', size: 'sm', color: '#16A34A', weight: 'bold' }] : []),
        ...(!current ? [{ type: 'text', text: `ตอบ ${selectionNumber} หรือกดปุ่มด้านล่าง`, size: 'sm', color: '#667085', wrap: true }] : []),
        // Only where a switch actually happens. On the ✓ ใช้งานอยู่ bubble the chat is already on
        // this company, so promising "ระบบจะสลับบริษัทในไลน์ให้ด้วย" describes a change that will
        // not occur — the button there just opens the web.
        ...(company.webUrl && !current ? [{ type: 'text', text: COMPANY_PICKER_OPEN_WEB_HINT, size: 'xs', color: '#667085', wrap: true }] : []),
      ],
    },
    // `spacing` only where there is a gap to space, so a one-button footer stays byte-identical to
    // the one this picker has always sent.
    ...(buttons.length > 0
      ? { footer: { type: 'box', layout: 'vertical', ...(buttons.length > 1 ? { spacing: 'sm' } : {}), contents: buttons } }
      : {}),
  };
}

/**
 * LINE Flex carousels allow at most 12 bubbles. Eleven company bubbles plus one navigation
 * bubble keep every company reachable without silently dropping a name.
 *
 * Exported because a caller that mints one handoff token per VISIBLE bubble has to read the same
 * page rule the renderer applies; re-deriving it there would mint for companies this carousel
 * never shows, and drift the moment either copy changes.
 */
export function companyPickerPage<T extends CompanyPickerItem>(
  companies: T[],
  currentCompanyId?: string,
  requestedPage = 1,
): { visible: T[]; page: number; pageCount: number } {
  const current = companies.find((company) => company.companyId === currentCompanyId);
  const ordered = current ? [current, ...companies.filter((company) => company.companyId !== current.companyId)] : companies;
  const pageSize = companies.length > 12 ? 11 : 12;
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const page = Math.max(1, Math.min(requestedPage, pageCount));
  return { visible: ordered.slice((page - 1) * pageSize, page * pageSize), page, pageCount };
}

export function buildCompanyPickerMessage(companies: CompanyPickerItem[], currentCompanyId?: string, requestedPage = 1): LineReplyMessage {
  if (companies.length === 0) return { type: 'text', text: 'ไม่พบบริษัทที่ใช้งานได้ในขณะนี้' };

  const { visible, page, pageCount } = companyPickerPage(companies, currentCompanyId, requestedPage);
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
  | 'package_change' | 'employee' | 'staff_contact' | 'package_callback' | 'profile_guard' | 'profile_guard_later'
  // §2.4 delta: the typed aliases of the way out of the support pause. The tile's own words are
  // `talk`, which the use case routes by pause state.
  | 'resume_ai'
  // S-4 (draft-control spec §5.4): typed words still enter the command lane, but only the card
  // postback carries the opaque previewId required to apply or cancel that exact proposal.
  | 'draft_update_confirm' | 'draft_update_cancel'
  | 'follow';

/**
 * The whole-string key a command is matched on: tile emoji stripped, inner whitespace collapsed,
 * Latin case folded.
 *
 * UAT 2026-09-06. The pause reply printed พิมพ์ "คุยกับ AI ต่อ" (now a typed alias); the customer
 * typed exactly that and the phone keyboard wrote "ai", so the way out of a 24-hour hold fell
 * through to the hold and was filed as another message for the operator. "AI" is the only Latin
 * word this table contains (audited: every other command is pure Thai), and Thai has no case, so
 * the fold changes nothing else — and collapsing runs of spaces only touches the three aliases
 * that have a space at all.
 *
 * Still a WHOLE-string match, which is the §3 property: a sentence that merely quotes a command —
 * a pasted instruction, an OCR'd caption — resumes nothing.
 */
function menuCommandKey(text: string): string {
  return text.trim().replace(/[📊✅📷🎁]/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

export function staffMenuCommand(text: string): StaffMenuCommand | null {
  const normalized = menuCommandKey(text);
  if (normalized === 'เมนูหลัก') return 'main';
  if (normalized === 'ถามข้อมูล') return 'query';
  if (normalized === 'รายการรออนุมัติ') return 'approval';
  if (normalized === 'ถ่ายใบเสร็จ') return 'receipt';
  if (normalized === 'บริการของเรา') return 'services';
  if (normalized === 'ติดต่อเรา') return 'contact';
  if (normalized === RESUME_AI_COMMAND) return 'talk';
  if (normalized === PACKAGE_CHANGE_COMMAND || normalized === 'ขอเปลี่ยนแพ็คเกจ') return 'package_change';
  if (normalized === EMPLOYEE_DOOR_COMMAND) return 'employee';
  if (normalized === STAFF_CONTACT_COMMAND) return 'staff_contact';
  if (normalized === PACKAGE_CALLBACK_COMMAND) return 'package_callback';
  if (RESUME_AI_ALIASES.some((alias) => normalized === menuCommandKey(alias))) return 'resume_ai';
  if (normalized === PROFILE_GUARD_COMMAND) return 'profile_guard';
  if (normalized === PROFILE_GUARD_LATER_COMMAND) return 'profile_guard_later';
  if (normalized === DRAFT_UPDATE_CONFIRM_COMMAND) return 'draft_update_confirm';
  if (normalized === DRAFT_UPDATE_CANCEL_COMMAND) return 'draft_update_cancel';
  if (normalized === LINE_FOLLOW_EVENT_TEXT) return 'follow';
  // The CONSTANT, like every other command above. The employee hint on the บริษัทของฉัน card prints
  // this word by interpolating `VIEW_PACKAGES_COMMAND`, so a literal re-typed here is the one way
  // that sentence could come to name a word this matcher no longer answers. `แพ็กเกจ` stays a bare
  // alias: nothing renders it, so nothing can drift from it.
  if (normalized === VIEW_PACKAGES_COMMAND || normalized === 'แพ็กเกจ' || normalized === 'แพ็คเกจ') return 'promotion';
  return null;
}

/**
 * P10-L G-04 / SEC-04. Ordinary menu postbacks carry only intent: no company id, request id, or
 * business state. Draft-edit confirm/cancel are the narrow exception; their separate parser below
 * requires an opaque previewId to keep an old card from acting on a newer proposal.
 */
const POSTBACK_ACTIONS: Readonly<Record<string, string>> = {
  'line-rich-talk': RESUME_AI_COMMAND,
  'package-change': PACKAGE_CHANGE_COMMAND,
  'package-callback': PACKAGE_CALLBACK_COMMAND,
  'profile-guard': PROFILE_GUARD_COMMAND,
  'profile-guard-later': PROFILE_GUARD_LATER_COMMAND,
};

/**
 * S-4: confirm/cancel buttons carry an opaque previewId. The API verifies that exact preview is
 * still current for this chat, so old or malformed postbacks cannot select a newer proposal.
 *
 * Gated on the flag, and this is the point: with S-4 off no card carries these buttons, so the only
 * thing that can send one is a forgery. Resolving it to a command anyway sent the event down the
 * text lane and into a PAID AI turn — before S-4 it resolved to null and was dropped. Flag off must
 * mean dropped again.
 */
const DRAFT_POSTBACK_ACTIONS: Readonly<Record<string, string>> = {
  'draft-update-confirm': DRAFT_UPDATE_CONFIRM_COMMAND,
  'draft-update-cancel': DRAFT_UPDATE_CANCEL_COMMAND,
};

/**
 * `action=<name>&…`; unknown or absent actions answer null so the event is dropped, not guessed.
 *
 * `draftEditEnabled` decides whether the two S-4 actions resolve at all. It defaults to false so a
 * caller that has not been taught about the flag keeps the pre-S-4 behaviour — dropped — rather
 * than the more permissive one.
 */
export function linePostbackCommandText(data: string | undefined, draftEditEnabled = false): string | null {
  if (!data) return null;
  let action: string | null;
  try {
    action = new URLSearchParams(data).get('action');
  } catch {
    return null;
  }
  if (!action) return null;
  if (draftEditEnabled && DRAFT_POSTBACK_ACTIONS[action]) return DRAFT_POSTBACK_ACTIONS[action]!;
  return POSTBACK_ACTIONS[action] ?? null;
}

const LINE_DRAFT_PREVIEW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isLineDraftPreviewId(value: unknown): value is string {
  return typeof value === 'string' && LINE_DRAFT_PREVIEW_ID.test(value);
}

/** A draft action is bound only by the exact, small postback shape rendered on its card. */
export function lineDraftUpdatePostbackPreviewId(data: string | undefined, commandText: string | null): string | undefined {
  if (!data || data.length > 256 || !commandText) return undefined;
  try {
    const entries = [...new URLSearchParams(data).entries()];
    if (entries.length !== 2) return undefined;
    const actions = entries.filter(([key]) => key === 'action');
    const ids = entries.filter(([key]) => key === 'previewId');
    if (actions.length !== 1 || ids.length !== 1) return undefined;
    const expectedAction = commandText === DRAFT_UPDATE_CONFIRM_COMMAND
      ? 'draft-update-confirm'
      : commandText === DRAFT_UPDATE_CANCEL_COMMAND ? 'draft-update-cancel' : undefined;
    if (!expectedAction || actions[0]![1] !== expectedAction || !isLineDraftPreviewId(ids[0]![1])) return undefined;
    return ids[0]![1];
  } catch {
    return undefined;
  }
}
