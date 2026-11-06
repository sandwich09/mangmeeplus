const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export const DEMO_STAFF = [
  { role: 'MANAGER', displayName: 'คุณสมชาย (ผู้จัดการ)', jobTitle: 'ผู้จัดการ' },
  { role: 'FINANCE', displayName: 'คุณนภา (การเงิน)', jobTitle: 'การเงิน' },
  { role: 'STAFF', displayName: 'คุณต้น (พนักงาน)', jobTitle: 'พนักงาน' },
] as const;

export const DEMO_COUNTERPARTIES = [
  { key: 'market', displayName: 'ตลาดสดสี่มุมเมือง (ตัวอย่าง)', entityKind: 'INDIVIDUAL', taxId: '0994000000014' },
  { key: 'vegetables', displayName: 'บริษัท ผักสดดี จำกัด (ตัวอย่าง)', entityKind: 'JURISTIC', taxId: '0994000000022' },
  { key: 'gas', displayName: 'บริษัท แก๊สหุงต้มไทย จำกัด (ตัวอย่าง)', entityKind: 'JURISTIC', taxId: '0994000000031' },
  { key: 'repair', displayName: 'ช่างแอร์เย็นใจ (ตัวอย่าง)', entityKind: 'INDIVIDUAL', taxId: '0994000000049' },
  { key: 'landlord', displayName: 'คุณสมศรี ใจดี (เจ้าของที่)', entityKind: 'INDIVIDUAL', taxId: '0994000000057' },
] as const;

type ExpensePattern = {
  day: number;
  vendor: string;
  counterpartyKey?: typeof DEMO_COUNTERPARTIES[number]['key'];
  category: string;
  accountHintKey: string;
  satang: number;
};

const PATTERN: readonly ExpensePattern[] = [
  { day: 1, vendor: 'คุณสมศรี ใจดี (เจ้าของที่)', counterpartyKey: 'landlord', category: 'ค่าเช่า', accountHintKey: 'expense.rent', satang: 1800000 },
  { day: 3, vendor: 'บริษัท ผักสดดี จำกัด (ตัวอย่าง)', counterpartyKey: 'vegetables', category: 'วัตถุดิบ', accountHintKey: 'expense.meals', satang: 428000 },
  { day: 5, vendor: 'ตลาดสดสี่มุมเมือง (ตัวอย่าง)', counterpartyKey: 'market', category: 'วัตถุดิบ', accountHintKey: 'expense.meals', satang: 215000 },
  { day: 6, vendor: 'บริษัท แก๊สหุงต้มไทย จำกัด (ตัวอย่าง)', counterpartyKey: 'gas', category: 'ค่าแก๊ส', accountHintKey: 'expense.utilities', satang: 164000 },
  { day: 8, vendor: 'การไฟฟ้า (ใบแจ้งหนี้ตัวอย่าง)', category: 'ค่าน้ำค่าไฟ', accountHintKey: 'expense.utilities', satang: 691250 },
  { day: 9, vendor: 'ตลาดสดสี่มุมเมือง (ตัวอย่าง)', counterpartyKey: 'market', category: 'วัตถุดิบ', accountHintKey: 'expense.meals', satang: 138500 },
  { day: 10, vendor: 'บริษัท ผักสดดี จำกัด (ตัวอย่าง)', counterpartyKey: 'vegetables', category: 'วัตถุดิบ', accountHintKey: 'expense.meals', satang: 410000 },
  { day: 12, vendor: 'ตลาดสดสี่มุมเมือง (ตัวอย่าง)', counterpartyKey: 'market', category: 'วัตถุดิบ', accountHintKey: 'expense.meals', satang: 200000 },
  { day: 15, vendor: 'การประปา (ตัวอย่าง)', category: 'ค่าน้ำค่าไฟ', accountHintKey: 'expense.utilities', satang: 82000 },
  { day: 18, vendor: 'ร้านเครื่องครัว (ตัวอย่าง)', category: 'อุปกรณ์', accountHintKey: 'expense.office_supplies', satang: 145000 },
  { day: 20, vendor: 'บริษัท แก๊สหุงต้มไทย จำกัด (ตัวอย่าง)', counterpartyKey: 'gas', category: 'ค่าแก๊ส', accountHintKey: 'expense.utilities', satang: 160000 },
  { day: 25, vendor: 'ตลาดสดสี่มุมเมือง (ตัวอย่าง)', counterpartyKey: 'market', category: 'วัตถุดิบ', accountHintKey: 'expense.meals', satang: 190000 },
];

function money(satang: number): string {
  return `${Math.floor(satang / 100)}.${String(satang % 100).padStart(2, '0')}`;
}

/** All business dates are Bangkok midnight, including dates clamped to creation day. */
export function demoSampleRows(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Invalid demo creation date');
  const bangkok = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const year = bangkok.getUTCFullYear();
  const month = bangkok.getUTCMonth();
  const today = bangkok.getUTCDate();
  const date = (monthOffset: number, day: number) => {
    const instant = Date.UTC(year, month + monthOffset, day) - BANGKOK_OFFSET_MS;
    const creationDay = Date.UTC(year, month, today) - BANGKOK_OFFSET_MS;
    return new Date(Math.min(instant, creationDay));
  };
  const expenses = ([-2, -1, 0] as const).flatMap(monthOffset =>
    PATTERN.slice(0, monthOffset === 0 ? 6 : 12).map((pattern, index) => {
      const repair = monthOffset === -1 && pattern.day === 20;
      const satang = repair ? 350000 : Math.round(pattern.satang * (monthOffset === -2 ? 95 : monthOffset === -1 ? 105 : 100) / 100);
      const withheld = repair ? 10500 : 0;
      return {
        key: `expense-${monthOffset + 2}-${index + 1}`,
        sourceClaimKey: null as string | null,
        monthOffset,
        day: pattern.day,
        date: date(monthOffset, pattern.day),
        vendor: repair ? 'ช่างแอร์เย็นใจ (ตัวอย่าง)' : pattern.vendor,
        counterpartyKey: repair ? 'repair' as const : pattern.counterpartyKey,
        category: repair ? 'ค่าซ่อม' : pattern.category,
        accountHintKey: repair ? 'expense.repairs' : pattern.accountHintKey,
        amount: money(satang),
        whtAmount: money(withheld),
        whtRate: repair ? '3' : null,
        netPayableAmount: money(satang - withheld),
        status: monthOffset === 0 && index >= 4 ? 'READY_FOR_CONFIRMATION' as const : 'CONFIRMED' as const,
      };
    }));
  const claims = [
    { key: 'claim-fuel', title: 'ค่าน้ำมันรถส่งของ', amount: '500.00', date: date(0, Math.max(1, today - 1)), status: 'PENDING_APPROVAL', accountHintKey: 'expense.travel' },
    { key: 'claim-ice', title: 'ซื้อน้ำแข็งด่วน', amount: '240.00', date: date(0, 1), status: 'READY_FOR_PAYMENT', accountHintKey: 'expense.meals' },
    { key: 'claim-taxi', title: 'ค่าแท็กซี่ไปตลาด', amount: '180.00', date: date(-1, 25), status: 'PAID', accountHintKey: 'expense.travel' },
  ] as const;
  return {
    staff: DEMO_STAFF,
    counterparties: DEMO_COUNTERPARTIES,
    expenses: [...expenses, ...claims.filter(claim => claim.status !== 'PENDING_APPROVAL').map(claim => ({
      key: `projection-${claim.key}`,
      sourceClaimKey: claim.key,
      monthOffset: claim.status === 'PAID' ? -1 : 0,
      day: claim.status === 'PAID' ? 25 : 1,
      date: claim.date,
      vendor: 'เบิกคืนพนักงาน: คุณต้น (พนักงาน)',
      counterpartyKey: undefined,
      category: claim.accountHintKey === 'expense.meals' ? 'วัตถุดิบ' : 'ค่าเดินทาง',
      accountHintKey: claim.accountHintKey,
      amount: claim.amount,
      whtAmount: '0.00',
      whtRate: null,
      netPayableAmount: claim.amount,
      status: 'CONFIRMED' as const,
    }))],
    claims,
    certificate: { expenseKey: 'expense-1-11', date: date(-1, 20), grossAmount: '3500.00', whtRate: '3', withheldAmount: '105.00' },
  };
}
