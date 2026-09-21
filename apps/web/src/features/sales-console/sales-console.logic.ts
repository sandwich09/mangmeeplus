// Pure helpers for the มั่งมี sales console (spec §12 "Sales console", §13 S24/S30/S31, Q2/Q5/Q6).
// The API speaks satang and stable status keys; the เซลล์ on a phone thinks in baht and Thai, so
// every conversion, guardrail and label lives here where a unit test can hold it.
import {
  MENU_ENTITLEMENT_BINDINGS,
  PLAN_TIER_PRESETS,
  SALES_CODE_PATTERN,
  SALES_DEAL_OPEN_STATUSES,
  SALES_DEAL_CYCLES_MAX,
  SALES_DEAL_DESCRIPTION_MAX,
  SALES_DEAL_MONTHS_MAX,
  SALES_DEAL_REASON_MAX,
  SALES_REFERRAL_ADMIN_WINDOW_DAYS,
  SALES_REPORT_MAX_MONTHS,
  SALES_REPORT_MONTH_PATTERN,
  TIER_FEATURE_PRESETS,
  type SalesAgentView,
  type SalesAttributionFlag,
  type SalesAttributionSource,
  type SalesCompanyAccessState,
  type SalesDealBaseTier,
  type SalesDealCadence,
  type SalesDealInput,
  type SalesDealPriceState,
  type SalesDealSnapshot,
  type SalesDealStatus,
  type SalesDealView,
  type SalesMyWorkItem,
  type SalesMyWorkKind,
  type SalesReferralSource,
  type SalesReportMonth,
  type SalesReportRow,
  type SalesRoleKey,
  type MenuEntitlementBinding,
} from '@watchdog-bms/contracts';
import type { MangmeeTone } from '@/common/components/mangmee';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { t } from '@/common/i18n/workspace-i18n.logic';

/** Where the console lives. One constant, so the layout, the header and the gates cannot drift. */
export const SALES_HOME_PATH = '/sales/deals';

// ── money ──

/** Baht with at most two decimals. Parsed in parts so '249.50' cannot drift into 24949.99 satang. */
const BAHT_INPUT = /^(\d+)(?:\.(\d{1,2}))?$/;

export type BahtParse = { ok: true; satang: number } | { ok: false; message: string };

/** Empty is NOT a value here — each caller decides what an empty box means for its own field. */
export function parseBahtInput(raw: string): BahtParse {
  const trimmed = raw.trim().replace(/,/g, '');
  const parts = BAHT_INPUT.exec(trimmed);
  if (!parts) return { ok: false, message: 'กรอกจำนวนเงินเป็นบาท ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 2000.50' };
  const satang = Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(satang)) return { ok: false, message: 'จำนวนเงินมากเกินไป กรุณาตรวจตัวเลขแล้วกรอกใหม่' };
  return { ok: true, satang };
}

export const formatBaht = (satang: number) =>
  '฿' + (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Prefill for a baht box: satang are kept, never rounded away, so an edit round-trips unchanged. */
export const satangToBahtInput = (satang: number) =>
  satang % 100 === 0 ? String(satang / 100) : (satang / 100).toFixed(2);

// ── status vocabulary ──

/** Thai + tone for every deal status. `PAID`/`APPLIED` land here from Phase 3; naming them now
 *  costs one line each and keeps a Phase-3 row from rendering a raw enum on a เซลล์'s phone. */
export const SALES_DEAL_STATUS_META: Record<SalesDealStatus, { label: string; tone: MangmeeTone }> = {
  DRAFT: { label: 'ฉบับร่าง', tone: 'slate' },
  PENDING_APPROVAL: { label: 'รออนุมัติ', tone: 'amber' },
  APPROVED: { label: 'อนุมัติแล้ว', tone: 'brand' },
  PAID: { label: 'ลูกค้าชำระแล้ว', tone: 'teal' },
  APPLIED: { label: 'เปิดใช้งานแล้ว', tone: 'brand' },
  EXPIRED: { label: 'หมดอายุ', tone: 'slate' },
  REJECTED: { label: 'ถูกปฏิเสธ', tone: 'danger' },
  CANCELLED: { label: 'ยกเลิกแล้ว', tone: 'slate' },
};

export const SALES_ACCESS_STATE_META: Record<SalesCompanyAccessState, { label: string; tone: MangmeeTone }> = {
  NO_PACKAGE: { label: 'ยังไม่มีแพ็กเกจ', tone: 'danger' },
  TRIAL: { label: 'กำลังทดลองใช้', tone: 'amber' },
  ACTIVE: { label: 'ใช้งานอยู่', tone: 'brand' },
  EXPIRED: { label: 'หมดอายุ', tone: 'slate' },
};

export const SALES_ROLE_LABELS: Record<SalesRoleKey, string> = {
  MANGMEE_SALES_LEAD: 'หัวหน้าทีมขาย',
  MANGMEE_SALES: 'เซลล์',
};

/**
 * What happened after the customer paid, in one sentence (Phase 3). Null for every earlier status,
 * so a เซลล์ reading a DRAFT sees nothing new. A row that is APPLIED before its `appliedAt` is
 * observed still reads as paid — the date is the detail, the state is the news.
 */
export function dealPaymentNote(deal: Pick<SalesDealView, 'status' | 'paidAt' | 'appliedAt'>): string | null {
  if (deal.status !== 'PAID' && deal.status !== 'APPLIED') return null;
  const at = deal.status === 'APPLIED' ? deal.appliedAt ?? deal.paidAt : deal.paidAt;
  const when = at ? formatThaiDate(at) : null;
  if (deal.status === 'APPLIED') return when ? `ลูกค้าชำระแล้ว · เริ่มใช้งาน ${when}` : 'ลูกค้าชำระแล้ว · เปิดใช้งานให้ร้านแล้ว';
  return when ? `ลูกค้าชำระแล้ว ${when} · กำลังเปิดสิทธิ์ให้ร้าน` : 'ลูกค้าชำระแล้ว · กำลังเปิดสิทธิ์ให้ร้าน';
}

/** DRAFT and REJECTED are the two states the เซลล์ may still edit (R3); APPROVED is immutable. */
export function isDealEditable(status: SalesDealStatus): boolean {
  return status === 'DRAFT' || status === 'REJECTED';
}

/** Cancel stays open exactly while the deal still holds the company's one open slot (R3/S18). */
export function isDealCancellable(status: SalesDealStatus): boolean {
  return SALES_DEAL_OPEN_STATUSES.includes(status);
}

// ── Phase 5: auto-renewing deals (§17.3 / D-P5-1…7) ──

/**
 * The v3 switch read defensively (D-P5-1): a v2 snapshot has no `autoRenew` at all and is a
 * one-time deal by definition, so `undefined` and `false` answer the same. Only `month`/`year`
 * exist (D-P5-2: `assertStripePrice` accepts no other recurring interval), so anything else reads
 * as monthly rather than putting a machine token on a เซลล์'s phone inside "ต่ออายุทุก…".
 */
export type DealAutoRenew = { cadence: SalesDealCadence; /** null = จนกว่าจะเพิกถอน. */ cycles: number | null };
type DealSnapshotLike = Partial<SalesDealSnapshot> | null | undefined;

export function dealAutoRenew(snapshot: DealSnapshotLike): DealAutoRenew | null {
  if (!snapshot?.autoRenew) return null;
  const cycles = snapshot.cycles;
  return {
    cadence: snapshot.cadence === 'year' ? 'year' : 'month',
    cycles: typeof cycles === 'number' && Number.isInteger(cycles) && cycles > 0 ? cycles : null,
  };
}

/** How long the shop is buying, in one phrase — the line every deal row and summary shares. */
export function dealTermText(snapshot: Partial<SalesDealSnapshot> & Pick<SalesDealSnapshot, 'months'>): string {
  const auto = dealAutoRenew(snapshot);
  if (!auto) return `${snapshot.months} เดือน`;
  const every = auto.cadence === 'year' ? 'ทุกปี' : 'ทุกเดือน';
  return auto.cycles ? `ต่ออายุ${every} · ${auto.cycles} รอบ` : `ต่ออายุ${every} · จนกว่าจะเพิกถอน`;
}

/**
 * D-P5-3: the per-shop Stripe Price is created at approval, and the customer cannot be shown an
 * offer that has no price behind it yet. `PENDING` is the normal few minutes; `FAILED` is the sweep
 * still retrying — neither is anything the เซลล์ does by hand, so both say what happens next rather
 * than offering a button that would do it twice.
 */
const DEAL_PRICE_STATE_META = {
  PENDING: {
    label: 'กำลังเตรียมราคา', tone: 'amber' as MangmeeTone,
    note: 'ระบบกำลังเตรียมราคาเฉพาะร้านนี้กับผู้ให้บริการชำระเงิน ลูกค้าจะเห็นข้อเสนอเมื่อเตรียมเสร็จ ปกติไม่เกินสองสามนาที',
  },
  FAILED: {
    label: 'เตรียมราคายังไม่สำเร็จ', tone: 'danger' as MangmeeTone,
    note: 'ยังเตรียมราคาเฉพาะร้านนี้ไม่สำเร็จ ระบบจะลองใหม่ให้เองเป็นระยะ ถ้าพรุ่งนี้ยังไม่หาย กรุณาแจ้งทีมงาน',
  },
};

export function dealPriceState(deal: { priceState?: SalesDealPriceState | null }): { label: string; tone: MangmeeTone; note: string } | null {
  const state = deal.priceState;
  return state === 'PENDING' || state === 'FAILED' ? DEAL_PRICE_STATE_META[state] : null;
}

// ── deal form ──

export type SalesDealFormValues = {
  companyId: string;
  base: SalesDealBaseTier;
  priceBaht: string;
  months: string;
  /** D-P5-1: the deal charges every cycle instead of once. `months` is then ignored. */
  autoRenew: boolean;
  /** Stripe recurring allows nothing else, so the form offers nothing else (D-P5-2). */
  cadence: SalesDealCadence;
  /** '' = จนกว่าจะเพิกถอน; '1'–'36' = that many cycles, then back to the catalog price. */
  cycles: string;
  branchLimit: string;
  employeeLimit: string;
  monthlySlipLimit: string;
  featureKeys: string[];
  /** '' = the tier default; ≥ 1 บาท otherwise. Closing AI is removing its menu (D-P3-2). */
  aiBudgetBaht: string;
  description: string;
  internalReason: string;
};

export type SalesDealFormErrors = Partial<Record<keyof SalesDealFormValues, string>>;

export { SALES_DEAL_BASE_TIERS } from '@watchdog-bms/contracts';

export function baseTierLabel(base: SalesDealBaseTier): string {
  return PLAN_TIER_PRESETS[base].labelTh;
}

/** The limits the picked tier hands the form. Kept out of the component so the reset is testable. */
export function baseTierDefaults(base: SalesDealBaseTier): Pick<SalesDealFormValues, 'branchLimit' | 'employeeLimit' | 'monthlySlipLimit'> {
  const preset = PLAN_TIER_PRESETS[base];
  return {
    branchLimit: String(preset.branchLimit),
    employeeLimit: String(preset.employeeLimit),
    monthlySlipLimit: String(preset.monthlySlipLimit),
  };
}

/** Phase 6: the menus the picked tier sells, so a deal starts from the package the เซลล์ named
 *  instead of an empty picker they have to rebuild by hand. Same source the catalog card reads. */
export function baseTierFeatureKeys(base: SalesDealBaseTier): string[] {
  return [...TIER_FEATURE_PRESETS[base]];
}

export function emptyDealForm(): SalesDealFormValues {
  return {
    companyId: '',
    base: 'STARTER_249',
    priceBaht: '',
    months: '12',
    autoRenew: false,
    cadence: 'month',
    cycles: '',
    ...baseTierDefaults('STARTER_249'),
    featureKeys: baseTierFeatureKeys('STARTER_249'),
    aiBudgetBaht: '',
    description: '',
    internalReason: '',
  };
}

export function dealFormFromView(deal: SalesDealView): SalesDealFormValues {
  const snapshot = deal.snapshot;
  const auto = dealAutoRenew(snapshot);
  return {
    companyId: deal.company.companyId,
    base: snapshot.base,
    priceBaht: satangToBahtInput(snapshot.priceSatang),
    months: String(snapshot.months),
    autoRenew: auto !== null,
    cadence: auto?.cadence ?? 'month',
    cycles: auto?.cycles ? String(auto.cycles) : '',
    branchLimit: String(snapshot.branchLimit),
    employeeLimit: String(snapshot.employeeLimit),
    monthlySlipLimit: String(snapshot.monthlySlipLimit),
    featureKeys: [...snapshot.featureKeys],
    aiBudgetBaht: snapshot.aiMonthlyBudgetSatang === null ? '' : satangToBahtInput(snapshot.aiMonthlyBudgetSatang),
    description: snapshot.description,
    internalReason: deal.internalReason,
  };
}

const wholeNumber = (raw: string): number | null => {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) && Number.isSafeInteger(Number(trimmed)) ? Number(trimmed) : null;
};

/**
 * `forSubmit` is the only difference between บันทึกฉบับร่าง and ส่งอนุมัติ: a draft may be parked
 * half-typed, but nothing reaches a หัวหน้า without the internal reason that justifies a free price.
 */
export function validateDealForm(values: SalesDealFormValues, options: { forSubmit: boolean } = { forSubmit: false }): SalesDealFormErrors {
  const errors: SalesDealFormErrors = {};
  if (!values.companyId) errors.companyId = 'กรุณาเลือกร้านค้าก่อน';

  const price = parseBahtInput(values.priceBaht);
  if (!values.priceBaht.trim()) errors.priceBaht = 'กรอกราคาที่ลูกค้าต้องจ่าย';
  else if (!price.ok) errors.priceBaht = price.message;
  // D1: no floor and no ceiling — only "not free", because a zero-baht deal has nothing to pay.
  else if (price.satang < 1) errors.priceBaht = 'ราคาต้องมากกว่า 0 บาท';

  // D-P5-1: an auto-renewing deal sells cycles, not months — the months box is not even on screen,
  // so validating it would block a submit on a field nobody can see.
  if (values.autoRenew) {
    const cycles = values.cycles.trim() ? wholeNumber(values.cycles) : null;
    if (values.cycles.trim() && (cycles === null || cycles < 1 || cycles > SALES_DEAL_CYCLES_MAX)) {
      errors.cycles = `จำนวนรอบต้องเป็นจำนวนเต็ม 1–${SALES_DEAL_CYCLES_MAX} รอบ`;
    }
  } else {
    const months = wholeNumber(values.months);
    if (months === null || months < 1 || months > SALES_DEAL_MONTHS_MAX) {
      errors.months = `จำนวนเดือนต้องเป็นจำนวนเต็ม 1–${SALES_DEAL_MONTHS_MAX} เดือน`;
    }
  }

  for (const [field, label] of [
    ['branchLimit', 'จำนวนสาขา'], ['employeeLimit', 'จำนวนผู้ใช้'], ['monthlySlipLimit', 'ใบเสร็จต่อเดือน'],
  ] as const) {
    if (wholeNumber(values[field]) === null) errors[field] = `${label}ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป`;
  }

  if (values.aiBudgetBaht.trim()) {
    const budget = parseBahtInput(values.aiBudgetBaht);
    if (!budget.ok) errors.aiBudgetBaht = budget.message;
    // D-P3-2: the one writer of an AI budget in the system refuses 0 on purpose — switching AI off
    // is removing the AI menu, not funding it with nothing, and a 0 here would be refused at apply.
    else if (budget.satang < 1) errors.aiBudgetBaht = 'เครดิต AI ต้องมากกว่า 0 บาท · ถ้าต้องการปิด AI ให้เอาเมนู AI ออกแทน';
  }

  const description = values.description.trim();
  if (description.length > SALES_DEAL_DESCRIPTION_MAX) {
    errors.description = `โน้ตถึงลูกค้ายาวได้ไม่เกิน ${SALES_DEAL_DESCRIPTION_MAX} ตัวอักษร`;
  } else if (description.includes('+')) {
    // S24: the customer card renders this line as-is, and "+" is how the old package copy stacked
    // add-ons — a plus sign there reads as a promise of something that is not in the snapshot.
    errors.description = 'โน้ตถึงลูกค้าใส่เครื่องหมาย + ไม่ได้ กรุณาเขียนเป็นข้อความ';
  }

  const reason = values.internalReason.trim();
  if (reason.length > SALES_DEAL_REASON_MAX) {
    errors.internalReason = `เหตุผลภายในยาวได้ไม่เกิน ${SALES_DEAL_REASON_MAX} ตัวอักษร`;
  } else if (options.forSubmit && !reason) {
    errors.internalReason = 'กรุณาระบุเหตุผลภายในก่อนส่งอนุมัติ';
  }

  return errors;
}

/** Submit order, so "focus the first error" means the first one the เซลล์ would scroll to. */
const DEAL_FIELD_ORDER: readonly (keyof SalesDealFormValues)[] = [
  'companyId', 'base', 'priceBaht', 'months', 'autoRenew', 'cadence', 'cycles',
  'branchLimit', 'employeeLimit', 'monthlySlipLimit',
  'featureKeys', 'aiBudgetBaht', 'description', 'internalReason',
];

export function firstDealErrorField(errors: SalesDealFormErrors): keyof SalesDealFormValues | null {
  return DEAL_FIELD_ORDER.find((field) => errors[field]) ?? null;
}

/** Form → request body. Only called once the form validates, so every parse here is total. */
export function dealInputFromForm(values: SalesDealFormValues): SalesDealInput {
  const price = parseBahtInput(values.priceBaht);
  const budget = values.aiBudgetBaht.trim() ? parseBahtInput(values.aiBudgetBaht) : null;
  return {
    companyId: values.companyId,
    base: values.base,
    priceSatang: price.ok ? price.satang : 0,
    // `months` rides along unchanged on an auto-renewing deal: the snapshot ignores it, and sending
    // the box's untouched default keeps the API's own 1–36 check satisfied either way (D-P5-1).
    months: Number(values.months.trim()),
    autoRenew: values.autoRenew,
    cadence: values.autoRenew ? values.cadence : null,
    cycles: values.autoRenew && values.cycles.trim() ? Number(values.cycles.trim()) : null,
    branchLimit: Number(values.branchLimit.trim()),
    employeeLimit: Number(values.employeeLimit.trim()),
    monthlySlipLimit: Number(values.monthlySlipLimit.trim()),
    featureKeys: values.featureKeys,
    aiMonthlyBudgetSatang: budget && budget.ok ? budget.satang : null,
    description: values.description.trim(),
    internalReason: values.internalReason.trim(),
  };
}

// ── menus ──

/**
 * The menus a deal may grant. Same bindings the partner console toggles, minus the contextual
 * routes and the not-yet-built ones — a เซลล์ must not be able to promise a screen that does not
 * exist. Selling a menu is turning on its parent feature plus its own entitlement keys, exactly as
 * `toggleMenuCard` does for an admin, so a deal snapshot and an admin grant mean the same thing.
 */
export const SALES_DEAL_MENU_BINDINGS: readonly MenuEntitlementBinding[] = MENU_ENTITLEMENT_BINDINGS.filter(
  (binding) => binding.navigation !== 'contextual' && binding.status === 'ready'
    && binding.parentFeatureKey !== null && binding.entitlementKeys.length > 0,
);

/** Nav group order and Thai wording reused from the workspace dictionary — one source of truth. */
export const SALES_DEAL_MENU_GROUPS: readonly { key: string; label: string }[] = (
  ['main', 'operate', 'finance', 'growth', 'admin'] as const
).map((key) => ({
  key,
  label: key === 'main' ? 'ภาพรวม' : t(`nav.group.${key}` as 'nav.group.operate', 'th'),
}));

export function isMenuSelected(featureKeys: readonly string[], binding: MenuEntitlementBinding): boolean {
  return binding.entitlementKeys.every((key) => featureKeys.includes(key));
}

/**
 * Turning a menu off may not strip a parent another selected menu still needs — `crm` backs both
 * กล่องข้อความ and ลูกค้า, so a naive removal silently disabled the sibling the เซลล์ had just sold.
 */
export function toggleMenuSelection(
  featureKeys: readonly string[],
  binding: MenuEntitlementBinding,
  next: boolean,
): string[] {
  const parent = binding.parentFeatureKey;
  if (next) return [...new Set([...featureKeys, ...(parent ? [parent] : []), ...binding.entitlementKeys])];
  const remaining = featureKeys.filter((key) => !binding.entitlementKeys.includes(key));
  const parentStillNeeded = parent !== null && SALES_DEAL_MENU_BINDINGS.some(
    (other) => other.navKey !== binding.navKey && other.parentFeatureKey === parent
      && other.entitlementKeys.some((key) => remaining.includes(key)),
  );
  return parent !== null && !parentStillNeeded ? remaining.filter((key) => key !== parent) : remaining;
}

// ── warnings (never blocks; D1 says the price is free and Q5 says a running shop is allowed) ──

export type DealWarningInput = {
  priceSatang: number | null;
  catalogPriceSatang: number | null;
  accessState: SalesCompanyAccessState | null;
  /** Null until the deal has been saved once — the search row carries no branch/employee counts. */
  usage: { branchCount: number; employeeCount: number } | null;
  branchLimit: number | null;
  employeeLimit: number | null;
};

/** S31: the shop keeps what it already has, it just cannot add more. Say the number, not the rule. */
export function dealOverLimit(
  usage: { branchCount: number; employeeCount: number } | null,
  limits: { branchLimit: number | null; employeeLimit: number | null },
): { branches: number; employees: number } {
  if (!usage) return { branches: 0, employees: 0 };
  return {
    branches: limits.branchLimit === null ? 0 : Math.max(0, usage.branchCount - limits.branchLimit),
    employees: limits.employeeLimit === null ? 0 : Math.max(0, usage.employeeCount - limits.employeeLimit),
  };
}

export function dealWarnings(input: DealWarningInput): string[] {
  const warnings: string[] = [];
  if (input.priceSatang !== null && input.catalogPriceSatang !== null
    && input.catalogPriceSatang > 0 && input.priceSatang > input.catalogPriceSatang) {
    warnings.push(`ราคานี้สูงกว่าราคาปกติของแพ็กเกจฐานตามจำนวนเดือนเดียวกัน (${formatBaht(input.catalogPriceSatang)}) กรุณาตรวจอีกครั้งก่อนส่งอนุมัติ`);
  }
  // Q5: days left on the current package do NOT carry over, so the shop must be told before it buys.
  if (input.accessState === 'TRIAL' || input.accessState === 'ACTIVE') {
    warnings.push('ร้านนี้มีแพ็กเกจที่ยังใช้งานอยู่ วันที่เหลือของแพ็กเกจปัจจุบันไม่ทบ');
  }
  const over = dealOverLimit(input.usage, { branchLimit: input.branchLimit, employeeLimit: input.employeeLimit });
  if (over.branches > 0 || over.employees > 0) {
    const parts = [over.branches > 0 ? `${over.branches} สาขา` : '', over.employees > 0 ? `${over.employees} ผู้ใช้` : '']
      .filter(Boolean).join(' / ');
    warnings.push(`เกินลิมิตใหม่ ${parts} — ของเดิมคงอยู่ สร้างเพิ่มไม่ได้`);
  }
  return warnings;
}

// ── "งานของฉัน" (Q6 / S30) ──

const MY_WORK_META: Record<SalesMyWorkKind, { label: string; tone: MangmeeTone; note: string; needsAction: boolean }> = {
  APPROVAL_PENDING: { label: 'รอคุณอนุมัติ', tone: 'amber', note: 'ตรวจรายละเอียดแล้วกดอนุมัติหรือปฏิเสธ', needsAction: true },
  DEAL_REJECTED: { label: 'ถูกปฏิเสธ', tone: 'danger', note: 'แก้ไขตามเหตุผลแล้วส่งอนุมัติใหม่ได้', needsAction: true },
  DEAL_EXPIRED: { label: 'ข้อเสนอหมดอายุ', tone: 'slate', note: 'ลูกค้าไม่ได้ชำระภายในกำหนด สร้างข้อเสนอใหม่ได้', needsAction: true },
  DEAL_APPROVED_WAITING: { label: 'รอลูกค้าชำระเงิน', tone: 'brand', note: 'ลูกค้าเห็นข้อเสนอในหน้าแพ็กเกจแล้ว', needsAction: false },
  DEAL_APPLIED: { label: 'เปิดใช้งานแล้ว', tone: 'teal', note: 'ลูกค้าชำระเงินและเปิดใช้งานแพ็กเกจแล้ว', needsAction: false },
  // R-676-4: the customer bought a catalog package before paying the deal, so the offer was closed.
  DEAL_SUPERSEDED: { label: 'ลูกค้าซื้อแพ็กเกจเอง', tone: 'slate', note: 'ลูกค้าซื้อแพ็กเกจปกติแล้ว ข้อเสนอนี้จึงถูกปิด สร้างข้อเสนอใหม่ได้', needsAction: false },
  // D3/A: the sweep wrote the next term's offer 14 days out. The เซลล์ checks it before the
  // หัวหน้า approves, because the price and the limits are copied from a deal sold months ago.
  DEAL_RENEWAL_PENDING: { label: 'ข้อเสนอต่ออายุรออนุมัติ', tone: 'amber', note: 'ระบบสร้างข้อเสนอรอบถัดไปจากดีลเดิมให้แล้ว ตรวจราคาและสิทธิ์ก่อนหัวหน้าอนุมัติ', needsAction: true },
  // D-P5-6: 14 days before the shop goes back to the catalog price. The เซลล์ is the one who calls
  // the shop, so it needs doing — เจ้าของร้าน gets the same notice in their own console and on LINE.
  DEAL_ENDING: { label: 'ดีลใกล้สิ้นสุด', tone: 'amber', note: 'ดีลจะสิ้นสุดใน 14 วัน แล้วร้านกลับไปใช้ราคาปกติและเมนู/เครดิต AI ค่าเริ่มต้นของแพ็กเกจ ติดต่อลูกค้าก่อนถึงวันนั้น', needsAction: true },
};

/** An unknown kind from a newer API must read as work, not crash the whole queue on a phone. */
const MY_WORK_FALLBACK = { label: 'มีรายการใหม่', tone: 'slate' as MangmeeTone, note: 'เปิดดีลนี้เพื่อดูรายละเอียด', needsAction: false };

export function myWorkMeta(kind: SalesMyWorkKind) {
  return MY_WORK_META[kind] ?? MY_WORK_FALLBACK;
}

/** The เซลล์'s own reading of the badge: the queue only counts what somebody has to do. */
export function myWorkBadgeLabel(badge: number): string | null {
  if (!Number.isFinite(badge) || badge <= 0) return null;
  return badge > 99 ? '99+' : String(badge);
}

/** Items first, sorted so the ones that need action sit above the informational ones. */
export function sortMyWork(items: readonly SalesMyWorkItem[]): SalesMyWorkItem[] {
  return [...items].sort((a, b) => {
    const rank = Number(myWorkMeta(b.kind).needsAction) - Number(myWorkMeta(a.kind).needsAction);
    return rank !== 0 ? rank : b.at.localeCompare(a.at);
  });
}

// ── sales code + agent form ──

/** What the box may hold: uppercase A–Z and digits, at most 6 (D6). Typed lowercase is lifted. */
export function normalizeSalesCodeInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function salesCodeError(raw: string): string | null {
  return SALES_CODE_PATTERN.test(raw) ? null : 'รหัสเซลล์ต้องเป็นตัวอักษรอังกฤษตัวใหญ่หรือตัวเลข 3–6 ตัว';
}

export type SalesAgentFormValues = {
  username: string;
  displayName: string;
  phoneNumber: string;
  email: string;
  role: SalesRoleKey;
  teamLeadUserId: string;
  salesCode: string;
  legalName: string;
  nationalId: string;
  taxId: string;
  address: string;
  bankName: string;
  bankAccount: string;
  whtRatePercent: string;
};

export type SalesAgentFormErrors = Partial<Record<keyof SalesAgentFormValues, string>>;

export function emptyAgentForm(role: SalesRoleKey = 'MANGMEE_SALES'): SalesAgentFormValues {
  return {
    username: '', displayName: '', phoneNumber: '', email: '', role, teamLeadUserId: '', salesCode: '',
    legalName: '', nationalId: '', taxId: '', address: '', bankName: '', bankAccount: '', whtRatePercent: '3',
  };
}

/**
 * The same form serves two callers with different rights: a หัวหน้า creates a เซลล์ and never sees
 * the tax/bank block (S10), so `withProfile` decides whether those fields are validated at all
 * rather than the page hiding boxes whose values would still be sent.
 */
export function validateAgentForm(values: SalesAgentFormValues, options: { withProfile: boolean }): SalesAgentFormErrors {
  const errors: SalesAgentFormErrors = {};
  const username = values.username.trim();
  if (!username) errors.username = 'กรุณากรอกชื่อผู้ใช้';
  else if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) {
    errors.username = 'ชื่อผู้ใช้ 3–40 ตัว ใช้ภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง';
  }
  if (!values.displayName.trim()) errors.displayName = 'กรุณากรอกชื่อที่แสดง';
  const phone = values.phoneNumber.replace(/[^0-9]/g, '');
  if (phone && !/^0\d{9}$/.test(phone)) errors.phoneNumber = 'เบอร์มือถือต้องมี 10 หลัก เช่น 0812345678';
  const email = values.email.trim();
  if (email && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) errors.email = 'รูปแบบอีเมลไม่ถูกต้อง';
  if (values.salesCode.trim()) {
    const codeError = salesCodeError(values.salesCode.trim());
    if (codeError) errors.salesCode = codeError;
  }

  if (options.withProfile) {
    if (!values.legalName.trim()) errors.legalName = 'กรุณากรอกชื่อ-นามสกุลตามบัตรประชาชน';
    if (!/^\d{13}$/.test(values.nationalId.replace(/[^0-9]/g, ''))) errors.nationalId = 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก';
    const taxId = values.taxId.replace(/[^0-9]/g, '');
    if (taxId && taxId.length !== 13) errors.taxId = 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก';
    if (!values.address.trim()) errors.address = 'กรุณากรอกที่อยู่';
    if (!values.bankName.trim()) errors.bankName = 'กรุณากรอกชื่อธนาคาร';
    if (!/^\d{6,20}$/.test(values.bankAccount.replace(/[^0-9]/g, ''))) errors.bankAccount = 'เลขบัญชีธนาคารต้องเป็นตัวเลข 6–20 หลัก';
    const wht = Number(values.whtRatePercent.trim());
    if (!Number.isFinite(wht) || wht < 0 || wht > 100) errors.whtRatePercent = 'อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–100';
  }
  return errors;
}

/** Only an ACTIVE agent's code resolves at signup, so a suspended row says why it is inert. */
export function agentStatusMeta(agent: Pick<SalesAgentView, 'status'>): { label: string; tone: MangmeeTone } {
  return agent.status === 'ACTIVE'
    ? { label: 'ใช้งานอยู่', tone: 'brand' }
    : { label: 'ระงับการใช้งาน', tone: 'danger' };
}

// ── company referral (D6 admin repair) ──

/**
 * Who a shop is credited to. The partner-detail DTO does not declare this field yet, so the shape
 * lives here and `companyReferral` does the one narrow read. Delete both the moment
 * `PartnerCompanyDetailDto` grows `referralSales` — nothing else changes.
 */
export type CompanyReferralView = {
  userId: string; displayName: string; salesCode: string; referredAt: string; source: SalesReferralSource;
};

export function companyReferral(detail: unknown): CompanyReferralView | null {
  const found = (detail as { referralSales?: unknown } | null | undefined)?.referralSales;
  if (!found || typeof found !== 'object') return null;
  const row = found as Partial<CompanyReferralView>;
  return typeof row.displayName === 'string' && typeof row.salesCode === 'string'
    ? {
      userId: row.userId ?? '', displayName: row.displayName, salesCode: row.salesCode,
      referredAt: row.referredAt ?? '', source: row.source ?? 'ADMIN',
    }
    : null;
}

export function referralLabel(referral: CompanyReferralView | null): string {
  return referral ? `${referral.displayName} (${referral.salesCode})` : 'ไม่มี';
}

/**
 * D6 anti-gaming: an admin may set or correct the credited เซลล์ only within 30 days of the shop
 * being created. Computed in whole days from `createdAt`, the same field the API measures against,
 * so the button stops offering an edit the server would refuse.
 */
export function referralWindowOpen(createdAt: string | null | undefined, now: Date = new Date()): boolean {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (!Number.isFinite(created)) return false;
  const elapsedDays = (now.getTime() - created) / 86_400_000;
  return elapsedDays >= 0 && elapsedDays <= SALES_REFERRAL_ADMIN_WINDOW_DAYS;
}

// ── Phase 4: renewal / conversion, reports, anti-gaming flags ──

/**
 * What else is true about a deal besides its status: it charges every cycle (D-P5-1) and when that
 * stops (D-P5-6), whether its per-shop price is ready to be paid (D-P5-3), that it was written by
 * the renewal sweep (D3), or that paying it cancels a live subscription (Q7/S34). Each one changes
 * what the เซลล์ says to the shop, so they sit beside the status badge.
 *
 * The Phase 5 three are optional so a partial row — a list item, a test double — still reads: a
 * deal written before Phase 5 carries none of them.
 */
export type DealBadgeInput = Pick<SalesDealView, 'renewalOfRequestId' | 'conversionOf'>
  & Partial<Pick<SalesDealView, 'snapshot' | 'returnAt' | 'priceState'>>;

export function dealBadges(deal: DealBadgeInput): { label: string; tone: MangmeeTone }[] {
  const badges: { label: string; tone: MangmeeTone }[] = [];
  const auto = dealAutoRenew(deal.snapshot);
  if (auto) badges.push({ label: `ต่ออายุอัตโนมัติ · ${auto.cadence === 'year' ? 'รายปี' : 'รายเดือน'}`, tone: 'teal' });
  const price = dealPriceState(deal);
  if (price) badges.push({ label: price.label, tone: price.tone });
  // D-P5-6: the date the shop goes back to the catalog price — the one thing a เซลล์ is asked about
  // before it happens, and the notice the OWNER gets 14 days ahead refers to it.
  if (deal.returnAt) badges.push({ label: `จบดีล ${formatThaiDate(deal.returnAt)}`, tone: 'amber' });
  if (deal.renewalOfRequestId) badges.push({ label: 'ต่ออายุจากดีลเดิม', tone: 'teal' });
  if (deal.conversionOf) badges.push({ label: 'แทนที่สมาชิกเดิม', tone: 'amber' });
  return badges;
}

// ── anti-gaming flags (§17.1, D6) ──

/**
 * Why a row was held back from the totals, in the Owner's words. The fallback matters as much as
 * the three known keys: a flag added later on the API side must never reach a person as
 * `referral_anomaly_v2`, which is why this takes a plain string rather than the union.
 */
const SALES_FLAG_LABELS: Record<SalesAttributionFlag, string> = {
  self_referral: 'ผู้แนะนำและเจ้าของร้านเป็นคนเดียวกัน',
  repeat_owner: 'เจ้าของเดิมเปิดร้านเพิ่ม',
  referral_anomaly: 'รูปแบบผิดปกติ (จำนวน/ข้อมูลซ้ำ)',
};

export function salesFlagLabel(flag: string): string {
  return SALES_FLAG_LABELS[flag as SalesAttributionFlag] ?? 'พบความผิดปกติ กรุณาตรวจสอบ';
}

export const SALES_ATTRIBUTION_SOURCE_LABELS: Record<SalesAttributionSource, string> = {
  DEAL: 'ดีลพิเศษ',
  REFERRAL: 'แนะนำร้าน',
};

// ── report (§17.2 — one row per shop, counted once, so the report is a plain sum) ──

export type SalesReportTotals = Pick<SalesReportRow, 'dealActivations' | 'referralActivations' | 'amountSatang' | 'flaggedCount'>;

export function salesReportTotals(rows: readonly SalesReportRow[]): SalesReportTotals {
  return rows.reduce<SalesReportTotals>((sum, row) => ({
    dealActivations: sum.dealActivations + row.dealActivations,
    referralActivations: sum.referralActivations + row.referralActivations,
    amountSatang: sum.amountSatang + row.amountSatang,
    flaggedCount: sum.flaggedCount + row.flaggedCount,
  }), { dealActivations: 0, referralActivations: 0, amountSatang: 0, flaggedCount: 0 });
}

/** Newest month first, biggest seller first inside it — the reading order of "who sold what". */
export function sortSalesReportMonths(months: readonly SalesReportMonth[]): { monthKey: string; rows: SalesReportRow[]; totals: SalesReportTotals }[] {
  return [...months]
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
    .map((month) => {
      const rows = [...month.rows].sort((a, b) => b.amountSatang - a.amountSatang || a.displayName.localeCompare(b.displayName, 'th'));
      return { monthKey: month.monthKey, rows, totals: salesReportTotals(rows) };
    });
}

export function salesReportRowsOf(months: readonly SalesReportMonth[]): SalesReportRow[] {
  return months.flatMap((month) => month.rows);
}

/**
 * The teams the filter may offer. The summary now names each row's lead (`teamLeadDisplayName`);
 * a lead who also sells is named by their own row too, which is the fallback for an answer that
 * predates the field. Either way a lead nothing can name is left out rather than shown as a raw id.
 */
export function salesReportLeads(months: readonly SalesReportMonth[]): { userId: string; displayName: string }[] {
  const rows = salesReportRowsOf(months);
  const own = new Map(rows.map((row) => [row.salesUserId, row.displayName]));
  const leads = new Map<string, string>();
  for (const row of rows) {
    if (!row.teamLeadUserId || leads.has(row.teamLeadUserId)) continue;
    const named = row.teamLeadDisplayName ?? own.get(row.teamLeadUserId);
    if (named) leads.set(row.teamLeadUserId, named);
  }
  return [...leads].map(([userId, displayName]) => ({ userId, displayName }));
}

// ── month range ──

export type SalesReportRange = { from: string; to: string };

const monthKeyOf = (date: Date): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Default: last month and this one — long enough to show a trend, short enough to read. Shifted to
 * Bangkok first, because the API buckets by Bangkok months: between midnight and 07:00 local, a
 * UTC reading of "this month" is still the previous one for the first seven hours of every month.
 */
export function defaultSalesReportRange(now: Date = new Date()): SalesReportRange {
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const to = new Date(Date.UTC(bangkok.getUTCFullYear(), bangkok.getUTCMonth(), 1));
  const from = new Date(Date.UTC(bangkok.getUTCFullYear(), bangkok.getUTCMonth() - 1, 1));
  return { from: monthKeyOf(from), to: monthKeyOf(to) };
}

const monthsBetween = (from: string, to: string): number => {
  const [fromYear, fromMonth] = from.split('-').map(Number) as [number, number];
  const [toYear, toMonth] = to.split('-').map(Number) as [number, number];
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
};

/** Said in Thai before any call: the endpoint answers `SALES_REPORT_RANGE_INVALID` for all three. */
export function salesReportRangeError(range: SalesReportRange): string | null {
  if (!SALES_REPORT_MONTH_PATTERN.test(range.from) || !SALES_REPORT_MONTH_PATTERN.test(range.to)) {
    return 'กรุณาเลือกเดือนเริ่มต้นและเดือนสิ้นสุด';
  }
  if (range.from > range.to) return 'เดือนเริ่มต้นต้องไม่อยู่หลังเดือนสิ้นสุด';
  if (monthsBetween(range.from, range.to) > SALES_REPORT_MAX_MONTHS) {
    return `เลือกช่วงได้ครั้งละไม่เกิน ${SALES_REPORT_MAX_MONTHS} เดือน`;
  }
  return null;
}
