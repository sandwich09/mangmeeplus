import type { ExpenseSourceDraft, ExpenseSourceDraftInput } from '@watchdog-bms/contracts';

export type ExpenseSourceDraftFormValues = ExpenseSourceDraft['header'] & {
  items: Array<{
    itemRef: string;
    description: string;
    quantity: string;
    unitPrice: string;
    totalAmount: string;
    expenseCategoryId: string;
  }>;
};

const text = (value: string | null) => value ?? '';
const sourceValue = (value: string) => value.trim() || null;

export function expenseSourceDraftFormValues(sourceDraft: ExpenseSourceDraft): ExpenseSourceDraftFormValues {
  return {
    expenseDate: sourceDraft.header.expenseDate,
    vendorName: sourceDraft.header.vendorName,
    businessPurpose: sourceDraft.header.businessPurpose,
    items: sourceDraft.items.map((item) => ({
      itemRef: item.itemRef,
      description: text(item.description),
      quantity: text(item.quantity),
      unitPrice: text(item.unitPrice),
      totalAmount: text(item.totalAmount),
      expenseCategoryId: text(item.expenseCategoryId),
    })),
  };
}

export function expenseSourceDraftChanges(
  initial: ExpenseSourceDraftFormValues,
  current: ExpenseSourceDraftFormValues,
): ExpenseSourceDraftInput | null {
  const patch: ExpenseSourceDraftInput = {};
  for (const field of ['expenseDate', 'vendorName', 'businessPurpose'] as const) {
    const before = sourceValue(initial[field] ?? '');
    const after = sourceValue(current[field] ?? '');
    if (before !== after) patch[field] = after;
  }

  const initialItems = new Map(initial.items.map((item) => [item.itemRef, item]));
  const itemPatches = current.items.flatMap((item) => {
    const before = initialItems.get(item.itemRef);
    if (!before) {
      const added: NonNullable<ExpenseSourceDraftInput['items']>[number] = {};
      for (const field of ['description', 'quantity', 'unitPrice', 'totalAmount', 'expenseCategoryId'] as const) {
        const value = sourceValue(item[field]);
        if (value !== null) added[field] = value;
      }
      return Object.keys(added).length > 0 ? [added] : [];
    }
    const change: NonNullable<ExpenseSourceDraftInput['items']>[number] = { itemRef: item.itemRef };
    for (const field of ['description', 'quantity', 'unitPrice', 'totalAmount', 'expenseCategoryId'] as const) {
      const beforeValue = sourceValue(before[field]);
      const afterValue = sourceValue(item[field]);
      if (beforeValue !== afterValue) change[field] = afterValue;
    }
    return Object.keys(change).length > 1 ? [change] : [];
  });
  if (itemPatches.length > 0) patch.items = itemPatches;
  return Object.keys(patch).length > 0 ? patch : null;
}

export type ExpenseSourceDraftIssue = { itemRef: string; field: 'quantity' | 'unitPrice' | 'totalAmount' };
const decimal = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;

/** Empty is an unfinished fact, while a supplied value must be a valid non-negative decimal. */
export function expenseSourceDraftIssues(values: ExpenseSourceDraftFormValues): ExpenseSourceDraftIssue[] {
  return values.items.flatMap((item) => (
    (['quantity', 'unitPrice', 'totalAmount'] as const)
      .filter((field) => {
        const value = item[field].trim();
        return value !== '' && (!decimal.test(value) || (field === 'quantity' && Number(value) <= 0));
      })
      .map((field) => ({ itemRef: item.itemRef, field }))
  ));
}

export function expenseSourceDraftMissingLabels(
  sourceDraft: ExpenseSourceDraft,
  locale: 'th' | 'en',
): string[] {
  const itemNumbers = new Map(sourceDraft.items.map((item, index) => [item.itemRef, index + 1]));
  const fields: Record<string, { th: string; en: string }> = {
    expenseDate: { th: 'วันที่ในใบเสร็จ', en: 'Receipt date' },
    vendorName: { th: 'ชื่อร้านหรือผู้ขาย', en: 'Shop or vendor name' },
    businessPurpose: { th: 'ซื้อไปใช้ทำอะไร', en: 'Business purpose' },
    items: { th: 'สินค้าหรือบริการอย่างน้อยหนึ่งรายการ', en: 'At least one item or service' },
    description: { th: 'ชื่อสินค้าหรือบริการ', en: 'Item or service name' },
    quantity: { th: 'จำนวน', en: 'Quantity' },
    unitPrice: { th: 'ราคาต่อหน่วย', en: 'Unit price' },
    price: { th: 'ราคาต่อหน่วยหรือยอดรวม', en: 'Unit price or item total' },
    totalAmount: { th: 'ยอดรวมรายการ', en: 'Item total' },
    expenseCategoryId: { th: 'หมวดค่าใช้จ่าย', en: 'Expense category' },
  };
  return sourceDraft.missingFields.map((missing) => {
    const label = fields[missing.field]?.[locale] ?? missing.prompt;
    const itemNumber = missing.itemRef ? itemNumbers.get(missing.itemRef) : undefined;
    if (!itemNumber) return label;
    return locale === 'th' ? `รายการที่ ${itemNumber}: ${label}` : `Item ${itemNumber}: ${label}`;
  });
}

export function isExpenseSourceDraftMissing(
  sourceDraft: ExpenseSourceDraft,
  field: string,
  itemRef?: string,
): boolean {
  const fields = field === 'unitPrice' || field === 'totalAmount' ? [field, 'price'] : [field];
  return sourceDraft.missingFields.some((missing) => fields.includes(missing.field)
    && (itemRef === undefined ? missing.scope === 'DOCUMENT' : missing.itemRef === itemRef));
}
