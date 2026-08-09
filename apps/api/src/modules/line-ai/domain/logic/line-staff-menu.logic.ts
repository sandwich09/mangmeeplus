import type { LineQuickReplyItem, LineReplyMessage } from '../../infrastructure/line-reply.adapter';

export type StaffMenuContext = {
  displayName: string;
  roleLabel: string;
  branchScopeLabel: string;
  permissions: string[];
  webBaseUrl?: string;
  companyId: string;
  isOwner?: boolean;
};

export type CompanyPickerItem = {
  companyId: string;
  companyName: string;
};

const QUERY_ACTIONS = [
  ['ยอดขายวันนี้', 'ดูยอดขายวันนี้', ['sales.order.read', 'dashboard.read']],
  ['คิว/นัดวันนี้', 'ดูคิววันนี้', ['crm.booking.read']],
  ['แชทค้างตอบ', 'ดูแชทค้างตอบ', ['crm.inbox.read']],
  ['ค่าใช้จ่ายเดือนนี้', 'ดูค่าใช้จ่ายเดือนนี้', ['expense.read']],
  ['รายงานการเงิน', 'ดูรายงานการเงิน', ['report.finance.read', 'ledger.read']],
  ['ใบสั่งซื้อ (PO)', 'ดูใบสั่งซื้อ', ['procurement.purchase_order.read', 'procurement.purchase_order.read_related']],
] as const;

const hasAny = (permissions: Set<string>, required: readonly string[]) => required.some((key) => permissions.has(key));

const messageAction = (label: string, text = label) => ({ type: 'action' as const, action: { type: 'message' as const, label, text } });

export function buildStaffMainMenu(context: StaffMenuContext): LineReplyMessage {
  const permissions = new Set(context.permissions);
  const items: LineQuickReplyItem[] = QUERY_ACTIONS
    .filter(([, , required]) => hasAny(permissions, required))
    .map(([label, text]) => messageAction(label, text));
  items.push(messageAction('📊 ถามข้อมูล', 'ถามข้อมูล'));
  if (context.isOwner) items.push(messageAction('🏢 บริษัทของฉัน', '/companies'));
  if (hasAny(permissions, ['procurement.purchase_request.approve', 'procurement.purchase_order.approve', 'reimbursement.approve'])) {
    items.push(messageAction('✅ รายการรออนุมัติ', 'รายการรออนุมัติ'));
  }
  if (hasAny(permissions, ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create'])) {
    items.push({ type: 'action', action: { type: 'camera', label: '📷 ถ่ายใบเสร็จ' } } as const);
  }
  const displayName = boundedLabel(context.displayName, 'พนักงาน');
  const roleLabel = boundedLabel(context.roleLabel, 'พนักงาน');
  const scopeLabel = context.branchScopeLabel;
  return {
    type: 'flex',
    altText: `สวัสดีค่ะ ${displayName} 👋\nตำแหน่ง ${roleLabel} · ดูข้อมูลได้ ${scopeLabel} · เข้าถึง ${items.length} เมนู\nเมนูด้านล่างแสดงเฉพาะสิ่งที่ตำแหน่งคุณมีสิทธิ์เข้าถึง`,
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
          { type: 'text', text: 'เมนูด้านล่างแสดงเฉพาะสิ่งที่ตำแหน่งคุณมีสิทธิ์เข้าถึง', wrap: true, size: 'xs', color: '#667085' },
        ],
      },
      styles: { body: { backgroundColor: '#FFFFFF' } },
    },
    quickReply: { items },
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
    .filter(([, , required]) => hasAny(permissions, required))
    .map(([label, text]) => messageAction(label, text));
  items.push(messageAction('« เมนูหลัก', 'เมนูหลัก'));
  return {
    type: 'text',
    text: 'อยากดูข้อมูลส่วนไหนดีคะ 📊\nแสดงเฉพาะเมนูที่ตำแหน่งคุณมีสิทธิ์เข้าถึง',
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

/** One button per real approval queue the member can act on. Ordered as listed. */
const APPROVAL_SURFACES = [
  ['คำขอเบิกเงิน', ['reimbursement.approve'], 'reimbursements?tab=approvals'],
  ['ใบขอซื้อ/ใบสั่งซื้อ', ['procurement.purchase_request.approve', 'procurement.purchase_order.approve'], 'procurement'],
] as const;

export function buildPendingApprovalCard(context: StaffMenuContext): LineReplyMessage {
  const base = context.webBaseUrl?.replace(/\/$/, '');
  const permissions = new Set(context.permissions);
  const companySegment = `/companies/${encodeURIComponent(context.companyId)}/`;
  const buttons = base
    ? APPROVAL_SURFACES
      .filter(([, required]) => hasAny(permissions, required))
      .map(([label, , path]) => ({
        type: 'button', style: 'primary', color: '#12B76A',
        action: { type: 'uri', label, uri: `${base}${companySegment}${path}` },
      }))
    : [];
  return {
    type: 'flex',
    altText: 'รายการรออนุมัติ',
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
        { type: 'text', text: '✅ รายการรออนุมัติ', weight: 'bold', size: 'lg', color: '#101828' },
        { type: 'text', text: 'เปิดรายการจริงในเว็บเพื่อดูรายละเอียด ตรวจเพดานวงเงิน และยืนยันอย่างปลอดภัย', wrap: true, color: '#667085', size: 'sm' },
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
