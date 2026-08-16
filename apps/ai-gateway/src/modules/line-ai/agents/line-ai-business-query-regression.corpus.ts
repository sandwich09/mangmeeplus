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
] as const;

export const CUSTOMER_CLARIFICATION_REGRESSION = {
  originalText: 'มีลูกค้าเยอะไหม',
  question: 'ต้องการจำนวนลูกค้าทั้งหมดหรือลูกค้าใหม่ครับ',
  answer: 'ทั้งหมด',
  subject: 'customer',
} as const;
