import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_CATALOG } from '@watchdog-bms/contracts';
import { availableApprovalSurfaceKeys, buildCapabilityCard, buildCompanyContextMessage, buildCompanyPickerMessage, buildContactCard, buildPendingApprovalCard, buildPromotionCard, buildReceiptCapturePrompt, buildServiceEntitlementMessage, buildStaffCompletionQuickReply, buildStaffMainMenu, buildStaffQueryMenu, isCapabilityQuestion, staffMenuCommand } from './line-staff-menu.logic';

// entitledFeatureKeys null is the legacy fail-open company, so these cases keep asserting the
// permission dimension on its own. Feature gating has its own cases at the end of the suite.
const context = { displayName: 'พิม · แอดมิน', roleLabel: 'แอดมิน', branchScopeLabel: '2 สาขา', companyId: 'c 1', webBaseUrl: 'https://app.example.com/', permissions: [], entitledFeatureKeys: null };

const ALL_PERMISSIONS = ['dashboard.read', 'crm.booking.read', 'crm.inbox.read', 'expense.read', 'ledger.read', 'procurement.purchase_order.read', 'procurement.purchase_order.approve', 'reimbursement.approve', 'expense.receipt.line_upload'];
const labels = (message: { quickReply?: { items: Array<{ action: { label: string } }> } }) =>
  message.quickReply?.items.map((item) => item.action.label);
/** buildStaffCompletionQuickReply returns the quick reply itself, not a message wrapping one. */
const quickLabels = (quickReply: { items: Array<{ action: { label: string } }> }) =>
  quickReply.items.map((item) => item.action.label);

describe('LINE staff menu', () => {
  it('shows only actions allowed by resolved backend permissions', () => {
    const message = buildStaffMainMenu({ ...context, permissions: ['line.ai.query', 'dashboard.read', 'crm.booking.read', 'crm.inbox.read', 'expense.read', 'ledger.read', 'procurement.purchase_order.read', 'procurement.purchase_order.approve', 'expense.receipt.line_upload'] });
    assert.equal(message.type, 'flex');
    assert.deepEqual(message.quickReply?.items.map((item) => item.action.label), ['ยอดขายวันนี้', 'คิว/นัดวันนี้', 'แชทค้างตอบ', 'ค่าใช้จ่ายเดือนนี้', 'รายงานการเงิน', 'ใบสั่งซื้อ (PO)', '📊 ถามข้อมูล', '✅ รายการรออนุมัติ', '📷 ถ่ายใบเสร็จ']);
    const restricted = buildStaffMainMenu(context);
    assert.equal(restricted.type, 'flex');
    assert.deepEqual(restricted.quickReply?.items.map((item) => item.action.label), ['📊 ถามข้อมูล']);
  });

  it('reuses the permission-filtered main menu after a completed turn within the LINE limit', () => {
    const allowed = { ...context, isOwner: true, permissions: ['dashboard.read', 'crm.booking.read', 'crm.inbox.read', 'expense.read', 'ledger.read', 'procurement.purchase_order.read', 'procurement.purchase_order.approve', 'expense.receipt.line_upload'] };
    const quickReply = buildStaffCompletionQuickReply(allowed);
    assert.deepEqual(quickReply, buildStaffMainMenu(allowed).quickReply);
    assert.ok(quickReply.items.length <= 13);
    assert.deepEqual(quickReply.items.slice(-3).map((item) => item.action.label), ['🏢 บริษัทของฉัน', '✅ รายการรออนุมัติ', '📷 ถ่ายใบเสร็จ']);
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
    const related = buildStaffQueryMenu({ ...context, permissions: ['procurement.purchase_order.read_related'] });
    assert.deepEqual(related.quickReply?.items.map((item) => item.action.label), ['ใบสั่งซื้อ (PO)', '« เมนูหลัก']);
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

  it('shows only current company, user, and human role labels in the context card', () => {
    const message = buildCompanyContextMessage({
      companyName: 'บริษัทมั่งมี จำกัด', displayName: 'พิมพ์ชนก', roleLabels: ['เจ้าของกิจการ', 'ฝ่ายบัญชี'],
    });
    assert.equal(message.type, 'flex');
    const rendered = JSON.stringify(message);
    assert.match(rendered, /บริษัทมั่งมี จำกัด/);
    assert.match(rendered, /คุณพิมพ์ชนก/);
    assert.match(rendered, /เจ้าของกิจการ · ฝ่ายบัญชี/);
    assert.equal(/companyId|membership|permission|branch/u.test(rendered), false);
  });

  it('builds tappable company cards using immutable company ids', () => {
    const message = buildCompanyPickerMessage([
      { companyId: 'co-1', companyName: 'บริษัทหนึ่ง' },
      { companyId: 'co-2', companyName: 'บริษัทสอง' },
    ], 'co-1');
    assert.equal(message.type, 'flex');
    assert.equal((message.contents as any).type, 'carousel');
    assert.match(JSON.stringify(message), /บริษัท 1/);
    assert.match(JSON.stringify(message), /บริษัท 2/);
    assert.match(JSON.stringify(message), /ตอบ 2 หรือกดปุ่มด้านล่าง/);
    assert.match(JSON.stringify(message), /\/company co-2/);
    assert.equal(JSON.stringify(message).includes('/company co-1'), false);
  });

  it('puts the current company first and paginates every owner company without dropping names', () => {
    const companies = Array.from({ length: 14 }, (_, index) => ({
      companyId: `co-${index + 1}`,
      companyName: index === 0 ? 'ก'.repeat(200) : `บริษัท ${index + 1}`,
    }));
    const first = buildCompanyPickerMessage(companies, 'co-14');
    const firstContents = (first as any).contents.contents;
    assert.equal(firstContents.length, 12);
    assert.match(JSON.stringify(firstContents[0]), /บริษัท 14/);
    assert.match(JSON.stringify(firstContents[0]), /ใช้งานอยู่/);
    assert.match(JSON.stringify(firstContents[11]), /หน้า 1\/2/);
    assert.match(JSON.stringify(firstContents[11]), /\/companies page 2/);
    assert.equal(JSON.stringify(first).includes('ก'.repeat(81)), false);

    const second = buildCompanyPickerMessage(companies, 'co-14', 2);
    const rendered = JSON.stringify(second);
    assert.match(rendered, /หน้า 2\/2/);
    assert.match(rendered, /\/companies page 1/);
    assert.match(rendered, /บริษัท 13/);
  });

  it('returns a safe text result for an empty company list', () => {
    assert.deepEqual(buildCompanyPickerMessage([]), { type: 'text', text: 'ไม่พบบริษัทที่ใช้งานได้ในขณะนี้' });
  });

  it('builds a safe receipt card whose only upload affordances are native camera actions', () => {
    const receipt = buildReceiptCapturePrompt(context);
    assert.equal(receipt.type, 'flex');
    assert.equal(receipt.altText, 'แนบรูปใบเสร็จเข้าระบบ');
    const contents = ((receipt.contents as any).body.contents as any[]);
    assert.equal(contents[0]?.text, 'แนบรูปใบเสร็จเข้าระบบ');
    assert.match(contents[1]?.text, /^กด “แนบรูปใบเสร็จ” หรือ “เปิดกล้อง”/);
    assert.match(contents[1]?.text, /ระบบจะบันทึกเป็นรายการรอตรวจสอบ ไม่อนุมัติหรือชำระเงินอัตโนมัติ/);
    assert.equal(contents.some((item) => item.type === 'image'), false, 'no decorative fake drop-zone');
    assert.deepEqual(receipt.quickReply?.items.slice(0, 2).map((item) => item.action.type), ['cameraRoll', 'camera']);
    const firstLabel = receipt.quickReply?.items[0]?.action.label;
    assert.equal(firstLabel, '🖼 แนบรูปใบเสร็จ');
  });

  it('builds the exact public contact card and safe actions', () => {
    const card = buildContactCard();
    assert.equal(card.type, 'flex');
    assert.equal(card.altText, 'ติดต่อมั่งมี Plus: contact@mangmeeplus.com โทร 098-256-5628');
    const rendered = JSON.stringify(card);
    assert.match(rendered, /contact@mangmeeplus.com/);
    assert.match(rendered, /098-256-5628/);
    assert.match(rendered, /tel:0982565628/);
    assert.match(rendered, /https:\/\/official\.mangmeeplus\.com\//);
    assert.match(rendered, /clipboardText/);
    assert.equal(rendered.includes('mailto:'), false);
    // P10-L §7 / HIGH-1: the rich menu's contact tile sends "ติดต่อเรา", which lands on THIS card.
    // Without a button here the keyword that actually reaches a person — pausing the assistant and
    // alerting the operators — was typing-only, and nobody could discover it.
    assert.match(rendered, /ติดต่อเจ้าหน้าที่/);
    assert.equal(staffMenuCommand('ติดต่อเจ้าหน้าที่'), 'staff_contact', 'and the label IS the command');
  });

  it('lists every and only enabled sellable top-level service in catalog order', () => {
    const enabled = new Set(['expenses', 'expenses.upload', 'ai_line_assistant', 'employee_access']);
    const card = buildServiceEntitlementMessage(enabled);
    const rendered = JSON.stringify(card);
    assert.match(rendered, /ค่าใช้จ่าย\+ใบเสร็จ/);
    assert.match(rendered, /ผู้ช่วย AI ทาง LINE/);
    assert.equal(rendered.includes('พนักงานและสิทธิ์'), false);
    assert.equal(rendered.includes('อัปโหลดใบเสร็จ'), false);

    const legacy = JSON.stringify(buildServiceEntitlementMessage(null));
    for (const feature of FEATURE_CATALOG.filter((item) => item.sellable)) assert.match(legacy, new RegExp(feature.labelTh.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const empty = buildServiceEntitlementMessage(new Set());
    assert.equal(empty.type, 'flex');
    assert.equal((empty as Extract<typeof empty, { type: 'flex' }>).altText, 'บริษัทนี้ยังไม่มีบริการที่เปิดใช้งานผ่าน LINE');
    assert.equal(JSON.stringify(empty).includes('✓ บริษัทนี้'), false);
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

  // UAT 2026-08-18: the card said only "เปิดรายการจริงในเว็บ", so an approver had to open the web
  // app to learn whether anything was waiting at all.
  describe('pending approval counts', () => {
    const cardText = (card: any) => (card.contents.body.contents as any[]).map((line) => line.text);

    it('states the total, names the queue, and lists at most five rows', () => {
      const card = buildPendingApprovalCard(
        { ...context, permissions: ['reimbursement.approve'] },
        { reimbursement: { total: 7, items: ['RB-1 · สมชาย · 1,130.00 บาท', 'RB-2', 'RB-3', 'RB-4', 'RB-5', 'RB-6'] } },
      );
      const text = cardText(card);
      assert.equal((card as { altText?: string }).altText, 'รายการรออนุมัติ 7 รายการ');
      assert.equal(text[1], 'มี 7 รายการรอคุณอนุมัติ');
      assert.equal(text[2], 'คำขอเบิกเงิน (7)');
      assert.deepEqual(text.slice(3, 9), ['• RB-1 · สมชาย · 1,130.00 บาท', '• RB-2', '• RB-3', '• RB-4', '• RB-5', 'แสดง 5 จาก 7 รายการ · เปิดในเว็บเพื่อดูทั้งหมดและยืนยันอย่างปลอดภัย']);
    });

    it('splits the five rows across the queues the member can act on', () => {
      const card = buildPendingApprovalCard(
        { ...context, permissions: ['reimbursement.approve', 'procurement.purchase_order.approve'] },
        {
          reimbursement: { total: 3, items: ['RB-1', 'RB-2', 'RB-3'] },
          procurement: { total: 4, items: ['PO-1', 'PO-2', 'PO-3', 'PO-4'] },
        },
      );
      assert.deepEqual(cardText(card).slice(2), [
        'คำขอเบิกเงิน (3)', '• RB-1', '• RB-2', '• RB-3',
        'ใบขอซื้อ/ใบสั่งซื้อ (4)', '• PO-1', '• PO-2',
        'แสดง 5 จาก 7 รายการ · เปิดในเว็บเพื่อดูทั้งหมดและยืนยันอย่างปลอดภัย',
      ]);
    });

    it('says the queue is empty when it was read, and stays silent about counts when it was not', () => {
      const empty = buildPendingApprovalCard({ ...context, permissions: ['reimbursement.approve'] }, { reimbursement: { total: 0, items: [] } });
      assert.deepEqual(cardText(empty), ['✅ รายการรออนุมัติ', 'ตอนนี้ไม่มีรายการรออนุมัติค่ะ']);

      const unread = buildPendingApprovalCard({ ...context, permissions: ['reimbursement.approve'] });
      assert.deepEqual(cardText(unread), ['✅ รายการรออนุมัติ', 'เปิดรายการจริงในเว็บเพื่อดูรายละเอียด ตรวจเพดานวงเงิน และยืนยันอย่างปลอดภัย']);
    });

    it('ignores a count for a queue this member cannot act on', () => {
      const card = buildPendingApprovalCard(
        { ...context, permissions: ['reimbursement.approve'] },
        { procurement: { total: 9, items: ['PO-1'] } },
      );
      assert.deepEqual(cardText(card), ['✅ รายการรออนุมัติ', 'เปิดรายการจริงในเว็บเพื่อดูรายละเอียด ตรวจเพดานวงเงิน และยืนยันอย่างปลอดภัย']);
    });

    it('names only the queues the caller should query', () => {
      assert.deepEqual(availableApprovalSurfaceKeys({ ...context, permissions: ['reimbursement.approve'] }), ['reimbursement']);
      assert.deepEqual(availableApprovalSurfaceKeys({ ...context, permissions: ALL_PERMISSIONS, entitledFeatureKeys: new Set(['procurement.purchase_orders']) }), ['procurement']);
    });
  });

  it('parses only explicit menu commands', () => {
    assert.equal(staffMenuCommand('📊 ถามข้อมูล'), 'query');
    assert.equal(staffMenuCommand('บริการของเรา'), 'services');
    assert.equal(staffMenuCommand('ติดต่อเรา'), 'contact');
    assert.equal(staffMenuCommand('คุยกับน้องมั่งมี'), 'talk');
    assert.equal(staffMenuCommand('ยอดขายวันนี้'), null);
  });

  // UAT 2026-08-15: ยอดขายวันนี้ was offered on a company that never switched sales on, so the
  // only possible answer was an empty one. A permission the company has not bought a feature for
  // is not a menu.
  describe('feature entitlement gate', () => {
    const withFeatures = (...featureKeys: string[]) =>
      ({ ...context, permissions: ALL_PERMISSIONS, entitledFeatureKeys: new Set(featureKeys) });

    it('hides every action whose owning feature the company has switched off', () => {
      const expensesOnly = withFeatures('expenses', 'expenses.upload');
      assert.deepEqual(labels(buildStaffMainMenu(expensesOnly)), ['ค่าใช้จ่ายเดือนนี้', '📊 ถามข้อมูล', '📷 ถ่ายใบเสร็จ']);
      assert.deepEqual(labels(buildStaffQueryMenu(expensesOnly)), ['ค่าใช้จ่ายเดือนนี้', '« เมนูหลัก']);
      // Same permissions, sales switched on: the reported button comes back.
      assert.ok(labels(buildStaffMainMenu(withFeatures('sales_documents')))?.includes('ยอดขายวันนี้'));
    });

    it('keeps every allowed action for a legacy company with no entitlement rows', () => {
      const legacy = { ...context, permissions: ALL_PERMISSIONS, entitledFeatureKeys: null };
      assert.deepEqual(labels(buildStaffMainMenu(legacy)), ['ยอดขายวันนี้', 'คิว/นัดวันนี้', 'แชทค้างตอบ', 'ค่าใช้จ่ายเดือนนี้', 'รายงานการเงิน', 'ใบสั่งซื้อ (PO)', '📊 ถามข้อมูล', '✅ รายการรออนุมัติ', '📷 ถ่ายใบเสร็จ']);
    });

    it('drops the approval button when no approval queue survives, and keeps it when one does', () => {
      assert.equal(quickLabels(buildStaffCompletionQuickReply(withFeatures('expenses'))).includes('✅ รายการรออนุมัติ'), false);

      const reimbursementOnly = withFeatures('reimbursement');
      assert.ok(quickLabels(buildStaffCompletionQuickReply(reimbursementOnly)).includes('✅ รายการรออนุมัติ'));
      // The card behind the button must show exactly the queue that justified offering it.
      const footer = (buildPendingApprovalCard(reimbursementOnly) as { contents: any }).contents.footer;
      assert.deepEqual(footer.contents.map((button: any) => button.action.label), ['คำขอเบิกเงิน']);
    });

    it('hides the receipt camera when the expenses upload submenu is off', () => {
      assert.equal(quickLabels(buildStaffCompletionQuickReply(withFeatures('expenses'))).includes('📷 ถ่ายใบเสร็จ'), false);
      assert.ok(quickLabels(buildStaffCompletionQuickReply(withFeatures('expenses', 'expenses.upload'))).includes('📷 ถ่ายใบเสร็จ'));
    });

    it('tells the user the menu reflects what the company enabled, not only their role', () => {
      assert.match(JSON.stringify(buildStaffMainMenu(context)), /บริษัทเปิดใช้/);
      assert.match((buildStaffQueryMenu(context) as { text: string }).text, /บริษัทเปิดใช้/);
    });
  });
});

describe('promotion menu (rich menu v2 ver2)', () => {
  it('matches the promotion command, emoji-prefixed and synonym forms included', () => {
    assert.equal(staffMenuCommand('โปรโมชั่น'), 'promotion');
    assert.equal(staffMenuCommand('แพ็กเกจ'), 'promotion');
    assert.equal(staffMenuCommand('🎁 โปรโมชั่น'), 'promotion');
    assert.equal(staffMenuCommand('โปรโมชั่นอะไรดี'), null);
  });

  // P10-L §3.7: the quota card prints "ขอเปลี่ยนแพ็กเกจ" on a button and the follow-up text tells
  // the shop to type it. Both were dead until L-B; they now pull the promotion card.
  // L-B replaced the L-A2 alias: the command now OPENS a request instead of showing the poster.
  it('routes the quota card\'s package-change command to the real request, not the poster', () => {
    assert.equal(staffMenuCommand('ขอเปลี่ยนแพ็กเกจ'), 'package_change');
    assert.equal(staffMenuCommand(' ขอเปลี่ยนแพ็กเกจ '), 'package_change', 'the button sends it verbatim');
    assert.equal(staffMenuCommand('ขอเปลี่ยนแพ็กเกจได้ไหม'), null, 'still a whole-message command');
    assert.equal(staffMenuCommand('โปรโมชั่น'), 'promotion', 'the poster keeps its own pull command');
  });

  it('builds the poster card from the web asset base and survives a missing base URL', () => {
    const withBase = JSON.stringify(buildPromotionCard('https://app.example.com/'));
    assert.match(withBase, /https:\/\/app\.example\.com\/assets\/line\/mangmeeplus-package-promo-1080x1350\.png/);
    assert.match(withBase, /ทดลองใช้ฟรี/);
    const withoutBase = JSON.stringify(buildPromotionCard(undefined));
    assert.ok(!withoutBase.includes('"hero"'), 'no hero image without a base URL');
    assert.match(withoutBase, /249/);
  });
});

describe('capability question (Owner 2026-08-27: only real features)', () => {
  it('catches short standalone capability questions', () => {
    assert.equal(isCapabilityQuestion('ทำอะไรได้บ้าง'), true);
    assert.equal(isCapabilityQuestion('น้องมั่งมีช่วยอะไรได้บ้าง'), true);
    assert.equal(isCapabilityQuestion('ระบบนี้ใช้ยังไง'), true);
    assert.equal(isCapabilityQuestion('มีฟีเจอร์อะไรบ้าง'), true);
  });

  it('never swallows a real business question that contains a stem', () => {
    assert.equal(isCapabilityQuestion('ใบกำกับภาษีใช้ยังไง'), false);
    assert.equal(isCapabilityQuestion('ยอดขายวันนี้เท่าไหร่'), false);
    assert.equal(isCapabilityQuestion('อยากรู้ว่าภ.ง.ด.53 ต้องยื่นยังไงและระบบภาษีทำอะไรได้บ้างช่วยอธิบายละเอียดหน่อย'), false);
    assert.equal(isCapabilityQuestion(''), false);
  });

  it('the curated card lists only the six real functions', () => {
    const card = JSON.stringify(buildCapabilityCard());
    for (const feature of ['ถ่ายใบเสร็จ', 'ยอดขายวันนี้', 'คุยกับน้องมั่งมี', 'บริษัทของฉัน', 'โปรโมชั่น', 'ติดต่อเรา']) {
      assert.ok(card.includes(feature), feature);
    }
  });
});
