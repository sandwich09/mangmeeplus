export const LINE_AI_BUSINESS_QUERY_REGRESSION_CORPUS = [
  {
    id: 'customer-count-th', language: 'th', message: 'ลูกค้าทั้งหมดมีกี่คน',
    subject: 'customer', tool: 'crm.get_customer_summary', forbiddenTool: 'company.get_employee_summary',
    expectedData: '12',
  },
  {
    id: 'customer-count-en', language: 'en', message: 'How many customers do we have?',
    subject: 'customer', tool: 'crm.get_customer_summary', forbiddenTool: 'company.get_employee_summary',
    expectedData: '12',
  },
] as const;

export const CUSTOMER_CLARIFICATION_REGRESSION = {
  originalText: 'มีลูกค้าเยอะไหม',
  question: 'ต้องการจำนวนลูกค้าทั้งหมดหรือลูกค้าใหม่ครับ',
  answer: 'ทั้งหมด',
  subject: 'customer',
} as const;
