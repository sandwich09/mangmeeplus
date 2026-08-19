import type { LineQuickReplyItem, LineReplyMessage } from '../../infrastructure/line-reply.adapter';

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

function companyBubble(company: CompanyPickerItem, selectionNumber: number, currentCompanyId?: string): Record<string, unknown> {
  const current = company.companyId === currentCompanyId;
  return {
    type: 'bubble',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', contents: [
        { type: 'text', text: `🏢 บริษัท ${selectionNumber}`, size: 'sm', color: '#667085' },
        { type: 'text', text: boundedLabel(company.companyName, company.companyId), weight: 'bold', size: 'lg', color: '#101828', wrap: true },
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

/** LINE Flex carousels allow at most 12 bubbles. Reserve the final bubble for an
 * honest overflow notice and keep the active company visible when it is beyond the cap. */
export function buildCompanyPickerMessage(companies: CompanyPickerItem[], currentCompanyId?: string): LineReplyMessage {
  if (companies.length === 0) return { type: 'text', text: 'ไม่พบบริษัทที่ใช้งานได้ในขณะนี้' };

  let visible = companies;
  let overflow = 0;
  if (companies.length > 12) {
    visible = companies.slice(0, 11);
    const current = companies.find((company) => company.companyId === currentCompanyId);
    if (current && !visible.some((company) => company.companyId === current.companyId)) visible[10] = current;
    overflow = companies.length - visible.length;
  }

  const bubbles = visible.map((company) => companyBubble(company, companies.findIndex((item) => item.companyId === company.companyId) + 1, currentCompanyId));
  if (overflow > 0) bubbles.push({
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      { type: 'text', text: `มีอีก ${overflow} บริษัท`, weight: 'bold', size: 'lg', color: '#101828' },
      { type: 'text', text: 'LINE แสดงได้สูงสุด 11 บริษัทในครั้งนี้ กรุณาใช้ตัวเลือกบริษัทในเว็บสำหรับรายการที่เหลือ', wrap: true, size: 'sm', color: '#667085' },
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

export function buildReceiptCapturePrompt(context: StaffMenuContext): LineReplyMessage {
  const base = context.webBaseUrl?.replace(/\/+$/, '');
  return {
    type: 'flex',
    altText: 'แนบรูปใบเสร็จเข้าระบบ',
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: [
        { type: 'text', text: 'แนบรูปใบเสร็จเข้าระบบ', weight: 'bold', size: 'md', color: '#101828' },
        { type: 'text', text: 'แนบรูปใบเสร็จให้เห็นข้อมูลครบทั้งใบ ส่งมาในแชทนี้ได้เลยค่ะ 🖼\nระบบจะบันทึกเป็นรายการรอตรวจสอบ ไม่อนุมัติหรือชำระเงินอัตโนมัติ', wrap: true, size: 'sm', color: '#667085' },
        ...(base ? [{ type: 'image', url: `${base}/assets/line/receipt-dropzone.png`, size: 'full', aspectRatio: '260:150', aspectMode: 'fit', margin: 'md' }] : []),
        { type: 'text', text: 'แตะปุ่ม "แนบรูปใบเสร็จ" ด้านล่าง', align: 'center', size: 'xs', weight: 'bold', color: '#12B76A', margin: 'sm' },
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

/** One entry per real approval queue the member can act on. Ordered as listed.
 *  [key, label, any-of permissions, web path, any-of feature keys]. */
const APPROVAL_SURFACES = [
  ['reimbursement', 'คำขอเบิกเงิน', ['reimbursement.approve'], 'reimbursements?tab=approvals', ['reimbursement']],
  ['procurement', 'ใบขอซื้อ/ใบสั่งซื้อ', ['procurement.purchase_request.approve', 'procurement.purchase_order.approve'], 'procurement', ['procurement.purchase_requests', 'procurement.purchase_orders']],
] as const;

export type ApprovalSurfaceKey = (typeof APPROVAL_SURFACES)[number][0];

/** What the card is allowed to state as fact about one queue: `total` is the whole queue the
 *  caller could read, `items` the first few already rendered as one line each (the caller owns the
 *  domain rows, this file owns the layout). A surface with NO entry was not read at all — the card
 *  then links out without claiming a number, so it can never say "none" over a failed query. */
export type PendingApprovalQueue = { total: number; items: string[] };
export type PendingApprovalQueues = Partial<Record<ApprovalSurfaceKey, PendingApprovalQueue>>;

/** How many rows the card shows before deferring the rest to the web queue. */
export const PENDING_APPROVAL_ITEM_LIMIT = 5;

/** The single source both the quick-reply button and the card itself read. Hoisted, so the quick
 *  reply above can call it. */
function availableApprovalSurfaces(permissions: Set<string>, entitled: ReadonlySet<string> | null) {
  return APPROVAL_SURFACES.filter(([, , required, , features]) =>
    hasAny(permissions, required) && hasFeature(entitled, features));
}

/** Which queues the caller should read before building the card. Same predicate as the card, so a
 *  query is never run for a surface the card will not show, and never skipped for one it will. */
export function pendingApprovalSurfaceKeys(
  context: Pick<StaffMenuContext, 'permissions' | 'entitledFeatureKeys'>,
): ApprovalSurfaceKey[] {
  return availableApprovalSurfaces(new Set(context.permissions), context.entitledFeatureKeys)
    .map(([key]) => key);
}

/**
 * Answers the question the button asks. A queue the caller read is stated as a number plus its
 * first `PENDING_APPROVAL_ITEM_LIMIT` rows — "none pending" is an answer, not a dead end — and the
 * web link stays for the detail, the ceiling check, and the actual approve. A queue the caller
 * could NOT read (missing read permission, or the query failed) keeps the link-only wording,
 * because silence is the only honest thing to say about a number nobody fetched.
 */
export function buildPendingApprovalCard(context: StaffMenuContext, queues: PendingApprovalQueues = {}): LineReplyMessage {
  const base = context.webBaseUrl?.replace(/\/$/, '');
  const permissions = new Set(context.permissions);
  const companySegment = `/companies/${encodeURIComponent(context.companyId)}/`;
  const surfaces = availableApprovalSurfaces(permissions, context.entitledFeatureKeys);
  const read = surfaces.map(([key]) => queues[key]).filter((queue): queue is PendingApprovalQueue => !!queue);
  const pending = read.reduce((sum, queue) => sum + queue.total, 0);
  const allRead = read.length === surfaces.length && surfaces.length > 0;

  const summary = allRead && pending === 0
    ? 'ตอนนี้ไม่มีรายการที่รอคุณอนุมัติค่ะ 🎉'
    : pending > 0
      ? `รอคุณอนุมัติ ${pending} รายการ · เปิดในเว็บเพื่อดูรายละเอียด ตรวจเพดานวงเงิน และยืนยันอย่างปลอดภัย`
      : 'เปิดรายการจริงในเว็บเพื่อดูรายละเอียด ตรวจเพดานวงเงิน และยืนยันอย่างปลอดภัย';

  const sections = surfaces.flatMap(([key, label]) => {
    const queue = queues[key];
    if (!queue) return [];
    if (queue.total === 0) return [{ type: 'text', text: `${label} · ไม่มีรายการรออนุมัติ`, wrap: true, size: 'sm', color: '#667085' }];
    const shown = queue.items.slice(0, PENDING_APPROVAL_ITEM_LIMIT);
    return [
      { type: 'text', text: `${label} · ${queue.total} รายการ`, weight: 'bold', size: 'sm', color: '#101828', wrap: true },
      ...shown.map((item) => ({ type: 'text', text: `• ${item}`, wrap: true, size: 'xs', color: '#667085' })),
      ...(queue.total > shown.length
        ? [{ type: 'text', text: `และอีก ${queue.total - shown.length} รายการในเว็บ`, size: 'xs', color: '#98A2B3', wrap: true }]
        : []),
    ];
  });

  // A queue read and known empty needs no button: there is nothing on the other side of it.
  const buttons = base
    ? surfaces
      .filter(([key]) => (queues[key]?.total ?? 1) > 0)
      .map(([, label, , path]) => ({
        type: 'button', style: 'primary', color: '#12B76A',
        action: { type: 'uri', label, uri: `${base}${companySegment}${path}` },
      }))
    : [];
  return {
    type: 'flex',
    altText: pending > 0 ? `รายการรออนุมัติ ${pending} รายการ` : 'รายการรออนุมัติ',
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
        { type: 'text', text: '✅ รายการรออนุมัติ', weight: 'bold', size: 'lg', color: '#101828' },
        { type: 'text', text: summary, wrap: true, color: '#667085', size: 'sm' },
        ...(sections.length > 0
          ? [{ type: 'box', layout: 'vertical', spacing: 'xs', contents: sections }]
          : []),
      ] },
      ...(buttons.length > 0 ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } } : {}),
    },
  };
}

export function staffMenuCommand(text: string): 'main' | 'query' | 'approval' | 'receipt' | null {
  const normalized = text.trim().replace(/[📊✅📷]/gu, '').trim();
  if (normalized === 'เมนูหลัก') return 'main';
  if (normalized === 'ถามข้อมูล') return 'query';
  if (normalized === 'รายการรออนุมัติ') return 'approval';
  if (normalized === 'ถ่ายใบเสร็จ') return 'receipt';
  return null;
}
