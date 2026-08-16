export const LINE_AI_BUSINESS_QUERY_REGRESSION_CORPUS = [
  {
    id: 'customer-count-th', language: 'th', message: 'ลูกค้าทั้งหมดมีกี่คน',
    subject: 'customer', agent: 'crm', tool: 'crm.get_customer_summary', forbiddenTool: 'company.get_employee_summary',
    permissions: ['crm.customer.read'], expectedData: '12',
    data: { total: 12, active: 10, archived: 2 },
    sourceRef: { label: 'ลูกค้า', module: 'crm', entityType: 'customer_summary', webPath: '/companies/c1/customers' },
  },
  {
    id: 'customer-count-en', language: 'en', message: 'How many customers do we have?',
    subject: 'customer', agent: 'crm', tool: 'crm.get_customer_summary', forbiddenTool: 'company.get_employee_summary',
    permissions: ['crm.customer.read'], expectedData: '12',
    data: { total: 12, active: 10, archived: 2 },
    sourceRef: { label: 'ลูกค้า', module: 'crm', entityType: 'customer_summary', webPath: '/companies/c1/customers' },
  },
  {
    id: 'customer-count-th-abbreviation', language: 'th', message: 'ลค. ทั้งหมดมีกี่คน',
    subject: 'customer', agent: 'crm', tool: 'crm.get_customer_summary', forbiddenTool: 'company.get_employee_summary',
    permissions: ['crm.customer.read'], expectedData: '12',
    data: { total: 12, active: 10, archived: 2 },
    sourceRef: { label: 'ลูกค้า', module: 'crm', entityType: 'customer_summary', webPath: '/companies/c1/customers' },
  },
  {
    id: 'owner-expense-th-abbreviations', language: 'th', message: 'ผปก. ขอสรุป คชจ. เดือนนี้',
    subject: 'expense', agent: 'accounting', tool: 'expense.list_recent', forbiddenTool: 'crm.get_customer_summary',
    permissions: ['expense.read'], expectedData: '8,745.06',
    data: { summary: { totalAmount: '8745.06', pendingAmount: '5855.06', confirmedAmount: '2890', paidAmount: '0', unpaidAmount: '8745.06' }, items: [] },
    sourceRef: { label: 'รายการค่าใช้จ่าย', module: 'expenses', entityType: 'expense_summary', webPath: '/companies/c1/expenses' },
  },
  {
    id: 'owner-daily-closing-th-abbreviations', language: 'th', message: 'ผปก. ขอสรุป คชจ. รายวันก่อนปิดร้าน วันนี้มีอะไรและต้องจ่ายอะไรบ้าง',
    subject: 'expense', agent: 'accounting', tool: 'expense.get_daily_closing', forbiddenTool: 'expense.list_recent',
    permissions: ['expense.read'], expectedData: '4 รายการ',
    expectedReply: ['สรุปปิดร้านวันที่ 2026-08-16', '4,500.00 THB', '10.00 USD', 'ถึงกำหนดวันนี้', 'เกินกำหนด', 'ยังไม่มีกำหนดจ่าย', 'รอตรวจ 2 รายการ', 'ไม่เคยส่งเข้าระบบ'],
    data: {
      date: '2026-08-16', timezone: 'Asia/Bangkok', scope: { kind: 'all_branches' },
      occurredToday: {
        totals: [{ currency: 'THB', count: 3, total: '4500' }, { currency: 'USD', count: 1, total: '10' }],
        paid: [{ currency: 'THB', count: 1, total: '1000' }],
        outstanding: [{ currency: 'THB', count: 2, total: '3500' }, { currency: 'USD', count: 1, total: '10' }],
        items: { total: 4, shown: 2, remaining: 2, items: [
          { expenseNumber: 'EXP-1', vendorName: 'ร้านวัตถุดิบ', currency: 'THB', grandTotalAmount: '1500', outstandingAmount: '1500', status: 'NEEDS_REVIEW', paymentStatus: 'UNPAID' },
          { expenseNumber: 'EXP-2', vendorName: 'SaaS', currency: 'USD', grandTotalAmount: '10', outstandingAmount: '10', status: 'CONFIRMED', paymentStatus: 'UNPAID' },
        ] },
      },
      submittedToday: { count: 5 },
      dueEndOfDay: { totals: [{ currency: 'THB', count: 1, total: '1500' }], items: { total: 1, shown: 1, remaining: 0, items: [{ vendorName: 'ร้านวัตถุดิบ', currency: 'THB', outstandingAmount: '1500' }] } },
      overdue: { totals: [{ currency: 'THB', count: 1, total: '2000' }], items: { total: 1, shown: 1, remaining: 0, items: [{ vendorName: 'ค่าเช่า', currency: 'THB', outstandingAmount: '2000' }] } },
      unscheduledOutstanding: { totals: [{ currency: 'USD', count: 1, total: '10' }], items: { total: 1, shown: 1, remaining: 0, items: [{ vendorName: 'SaaS', currency: 'USD', outstandingAmount: '10' }] } },
      pendingReview: { count: 2, items: { total: 2, shown: 0, remaining: 2, items: [] } },
      evidenceBlockers: { count: 1, items: { total: 1, shown: 0, remaining: 1, items: [] } },
      duplicateRisks: { count: 1, items: { total: 1, shown: 0, remaining: 1, items: [] } },
      excluded: { rejected: 1, voided: 0 }, observability: { queryDurationMs: 25, queryCount: 16, truncated: true },
      limitations: { neverSubmittedDocumentsObservable: false }, webUrl: '/companies/c1/expenses',
    },
    sourceRef: { label: 'สรุปปิดร้าน 2026-08-16', module: 'expenses', entityType: 'expense_daily_closing', webPath: '/companies/c1/expenses' },
  },
] as const;

export const CUSTOMER_CLARIFICATION_REGRESSION = {
  originalText: 'มีลูกค้าเยอะไหม',
  question: 'ต้องการจำนวนลูกค้าทั้งหมดหรือลูกค้าใหม่ครับ',
  answer: 'ทั้งหมด',
  subject: 'customer',
} as const;
