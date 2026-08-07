import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompanyPickerMessage, buildPendingApprovalCard, buildReceiptCapturePrompt, buildStaffMainMenu, buildStaffQueryMenu, staffMenuCommand } from './line-staff-menu.logic';

const context = { displayName: 'พิม · แอดมิน', roleLabel: 'แอดมิน', branchScopeLabel: '2 สาขา', companyId: 'c 1', webBaseUrl: 'https://app.example.com/', permissions: [] };

describe('LINE staff menu', () => {
  it('shows only actions allowed by resolved backend permissions', () => {
    const message = buildStaffMainMenu({ ...context, permissions: ['line.ai.query', 'dashboard.read', 'crm.booking.read', 'crm.inbox.read', 'expense.read', 'ledger.read', 'procurement.purchase_order.read', 'procurement.purchase_order.approve', 'expense.receipt.line_upload'] });
    assert.equal(message.type, 'flex');
    assert.deepEqual(message.quickReply?.items.map((item) => item.action.label), ['ยอดขายวันนี้', 'คิว/นัดวันนี้', 'แชทค้างตอบ', 'ค่าใช้จ่ายเดือนนี้', 'รายงานการเงิน', 'ใบสั่งซื้อ (PO)', '📊 ถามข้อมูล', '✅ รายการรออนุมัติ', '📷 ถ่ายใบเสร็จ']);
    const restricted = buildStaffMainMenu(context);
    assert.equal(restricted.type, 'flex');
    assert.deepEqual(restricted.quickReply?.items.map((item) => item.action.label), ['📊 ถามข้อมูล']);
  });

  it('renders honest greeting values and derives the menu count from Quick Reply items', () => {
    const message = buildStaffMainMenu(context);
    assert.equal(message.type, 'flex');
    assert.match(message.altText, /พิม · แอดมิน/);
    const boldSpans = ((message.contents as any).body.contents as any[])
      .flatMap((block) => block.contents ?? [])
      .filter((span) => span.weight === 'bold')
      .map((span) => span.text);
    assert.deepEqual(boldSpans, ['พิม · แอดมิน', 'แอดมิน', '2 สาขา', `${message.quickReply?.items.length} เมนู`]);
    assert.match(message.altText, /ดูข้อมูลได้ 2 สาขา/);

    const allBranches = buildStaffMainMenu({ ...context, branchScopeLabel: 'ทุกสาขา' });
    assert.match(JSON.stringify(allBranches), /ทุกสาขา/);
  });

  it('bounds display names before placing them in the greeting bubble', () => {
    const message = buildStaffMainMenu({ ...context, displayName: 'ก'.repeat(200) });
    assert.equal(JSON.stringify(message).includes('ก'.repeat(80)), true);
    assert.equal(JSON.stringify(message).includes('ก'.repeat(81)), false);
  });

  it('filters query shortcuts and retains a safe way back', () => {
    const message = buildStaffQueryMenu({ ...context, permissions: ['dashboard.read', 'crm.booking.read'] });
    assert.equal(message.type, 'text');
    assert.deepEqual(message.quickReply?.items.map((item) => item.action.label), ['ยอดขายวันนี้', 'คิว/นัดวันนี้', '« เมนูหลัก']);
  });

  it('shows บริษัทของฉัน only to owners and sends the existing deterministic command', () => {
    const owner = buildStaffMainMenu({ ...context, isOwner: true });
    const action = owner.quickReply?.items.find((item) => item.action.label === '🏢 บริษัทของฉัน')?.action;
    assert.deepEqual(action, { type: 'message', label: '🏢 บริษัทของฉัน', text: '/companies' });

    const staff = buildStaffMainMenu({ ...context, isOwner: false, permissions: ['access.role.manage'] });
    assert.equal(staff.quickReply?.items.some((item) => item.action.label === '🏢 บริษัทของฉัน'), false);
  });

  it('builds a single current-company bubble without a redundant switch action', () => {
    const message = buildCompanyPickerMessage([{ companyId: 'co-1', companyName: 'บริษัทหนึ่ง' }], 'co-1');
    assert.equal(message.type, 'flex');
    assert.equal((message.contents as any).type, 'bubble');
    assert.match(JSON.stringify(message), /ใช้งานอยู่/);
    assert.equal(JSON.stringify(message).includes('/company co-1'), false);
  });

  it('builds tappable company cards using immutable company ids', () => {
    const message = buildCompanyPickerMessage([
      { companyId: 'co-1', companyName: 'บริษัทหนึ่ง' },
      { companyId: 'co-2', companyName: 'บริษัทสอง' },
    ], 'co-1');
    assert.equal(message.type, 'flex');
    assert.equal((message.contents as any).type, 'carousel');
    assert.match(JSON.stringify(message), /\/company co-2/);
    assert.equal(JSON.stringify(message).includes('/company co-1'), false);
  });

  it('bounds labels and uses the twelfth bubble for an honest overflow notice', () => {
    const companies = Array.from({ length: 14 }, (_, index) => ({
      companyId: `co-${index + 1}`,
      companyName: index === 0 ? 'ก'.repeat(200) : `บริษัท ${index + 1}`,
    }));
    const message = buildCompanyPickerMessage(companies, 'co-14');
    const contents = (message as any).contents.contents;
    assert.equal(contents.length, 12);
    assert.equal(JSON.stringify(message).includes('ก'.repeat(81)), false);
    assert.match(JSON.stringify(message), /ใช้งานอยู่/);
    assert.match(JSON.stringify(contents[11]), /มีอีก 3 บริษัท/);
  });

  it('returns a safe text result for an empty company list', () => {
    assert.deepEqual(buildCompanyPickerMessage([]), { type: 'text', text: 'ไม่พบบริษัทที่ใช้งานได้ในขณะนี้' });
  });

  it('builds a safe receipt card with native camera actions and an optional image', () => {
    const receipt = buildReceiptCapturePrompt(context);
    assert.equal(receipt.type, 'flex');
    assert.equal(receipt.altText, 'แนบรูปใบเสร็จเข้าระบบ');
    const contents = ((receipt.contents as any).body.contents as any[]);
    assert.equal(contents[0]?.text, 'แนบรูปใบเสร็จเข้าระบบ');
    assert.match(contents[1]?.text, /^แนบรูปใบเสร็จ/);
    assert.equal(contents[1]?.text.includes('ถ่าย'), false);
    assert.match(contents[1]?.text, /ระบบจะบันทึกเป็นรายการรอตรวจสอบ ไม่อนุมัติหรือชำระเงินอัตโนมัติ/);
    const image = contents.find((item) => item.type === 'image');
    assert.equal(image?.url, 'https://app.example.com/assets/line/receipt-dropzone.png');
    const caption = contents.find((item) => item.text === 'แตะปุ่ม "แนบรูปใบเสร็จ" ด้านล่าง');
    assert.deepEqual(caption, { type: 'text', text: 'แตะปุ่ม "แนบรูปใบเสร็จ" ด้านล่าง', align: 'center', size: 'xs', weight: 'bold', color: '#12B76A', margin: 'sm' });
    assert.deepEqual(receipt.quickReply?.items.slice(0, 2).map((item) => item.action.type), ['cameraRoll', 'camera']);
    const firstLabel = receipt.quickReply?.items[0]?.action.label;
    assert.equal(firstLabel, '🖼 แนบรูปใบเสร็จ');
    assert.equal(caption.text, `แตะปุ่ม "${firstLabel.replace('🖼 ', '')}" ด้านล่าง`);

    const withoutImage = buildReceiptCapturePrompt({ ...context, webBaseUrl: undefined });
    const withoutImageContents = ((withoutImage as { contents: any }).contents.body.contents as any[]);
    assert.equal(withoutImageContents.some((item) => item.type === 'image'), false);
    assert.equal(withoutImageContents.some((item) => item.text === caption.text), true);
  });

  const approvalButtons = (permissions: string[]) => {
    const card = buildPendingApprovalCard({ ...context, permissions });
    assert.equal(card.type, 'flex');
    const footer = (card as { contents: any }).contents.footer;
    return (footer?.contents ?? []).map((button: any) => [button.action.label, button.action.uri]);
  };

  it('offers one tenant-scoped button per approval queue the member can act on', () => {
    assert.deepEqual(approvalButtons(['reimbursement.approve', 'procurement.purchase_order.approve']), [
      ['คำขอเบิกเงิน', 'https://app.example.com/companies/c%201/reimbursements?tab=approvals'],
      ['ใบขอซื้อ/ใบสั่งซื้อ', 'https://app.example.com/companies/c%201/procurement'],
    ]);
  });

  it('sends a reimbursement approver straight to the approvals tab only', () => {
    assert.deepEqual(approvalButtons(['reimbursement.approve']), [
      ['คำขอเบิกเงิน', 'https://app.example.com/companies/c%201/reimbursements?tab=approvals'],
    ]);
  });

  it('sends a purchase-request approver to procurement only', () => {
    assert.deepEqual(approvalButtons(['procurement.purchase_request.approve']), [
      ['ใบขอซื้อ/ใบสั่งซื้อ', 'https://app.example.com/companies/c%201/procurement'],
    ]);
  });

  it('never links to the demo settings page and drops the footer without a web base url', () => {
    const card = buildPendingApprovalCard({ ...context, permissions: ['reimbursement.approve'], webBaseUrl: undefined });
    assert.equal((card as { contents: any }).contents.footer, undefined);
    assert.equal(JSON.stringify(card).includes('po-approval'), false);
  });

  it('parses only explicit menu commands', () => {
    assert.equal(staffMenuCommand('📊 ถามข้อมูล'), 'query');
    assert.equal(staffMenuCommand('ยอดขายวันนี้'), null);
  });
});
