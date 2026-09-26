import type { VendorCounterpartyAutoSaveResult } from '@watchdog-bms/contracts';
import {
  COUNTERPARTY_ADDRESS_MAX_LENGTH,
  COUNTERPARTY_BRANCH_CODE_LENGTH,
  type CounterpartyAddressView,
  type CounterpartyAutoSaveNotice,
  type CounterpartyDetail,
  type CounterpartyFormIssue,
  type CounterpartyFormValues,
  type CounterpartySummary,
  type CounterpartyUsageBadge,
} from './counterparties.model';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Mirrors the API's `counterpartyAddressText`: v2 `addressText` first, then the legacy free-shape
 * keys older rows (procurement, CRM) may hold. Reading defensively here is what keeps a legacy row
 * from rendering as "ยังไม่มีที่อยู่" while the document printer happily finds text in it.
 */
export function counterpartyAddressText(json: unknown): string {
  if (typeof json === 'string') return json.trim();
  if (!isRecord(json)) return '';

  const v2 = trimmedString(json.addressText);
  if (v2) return v2;

  const legacy = trimmedString(json.address);
  if (legacy) return legacy;

  return [json.line1, json.line2, json.subdistrict, json.district, json.province, json.postalCode]
    .map(trimmedString)
    .filter(Boolean)
    .join(' ');
}

export function counterpartyAddress(json: unknown): CounterpartyAddressView {
  const record = isRecord(json) ? json : null;
  const history = Array.isArray(record?.seenOnDocuments) ? record.seenOnDocuments : [];
  const provenance = isRecord(record?.provenance) ? record.provenance : null;
  return {
    addressText: counterpartyAddressText(json),
    postalCode: trimmedString(record?.postalCode),
    locked: record?.locked === true,
    provenance: provenance && typeof provenance.source === 'string'
      ? (provenance as CounterpartyAddressView['provenance'])
      : null,
    // Newest first is the API's contract; entries without the three required keys are dropped
    // rather than rendered as an empty row with a button that would 404 on promote.
    seenOnDocuments: history.filter((entry): entry is { addressText: string; expenseId: string; at: string } =>
      isRecord(entry) && trimmedString(entry.addressText).length > 0
      && typeof entry.expenseId === 'string' && typeof entry.at === 'string'),
  };
}

export function counterpartyAddressMissing(row: Pick<CounterpartySummary, 'billingAddressJson'>): boolean {
  return counterpartyAddressText(row.billingAddressJson).length === 0;
}

/**
 * §11.1: "เคยซื้อ N ใบ / เคยขาย N ใบ", each hidden at 0. Built once here so the list row and the
 * detail page render identical badges instead of two hand-written copies drifting apart.
 */
export function counterpartyUsageBadges(row: Pick<CounterpartySummary, 'usageCounts'>): CounterpartyUsageBadge[] {
  const bought = row.usageCounts?.bought ?? 0;
  const sold = row.usageCounts?.sold ?? 0;
  const badges: CounterpartyUsageBadge[] = [];
  if (bought > 0) badges.push({ tone: 'sky', messageKey: 'counterparties.badge_bought', params: { count: String(bought) } });
  if (sold > 0) badges.push({ tone: 'brand', messageKey: 'counterparties.badge_sold', params: { count: String(sold) } });
  return badges;
}

/** One line for a list row: newlines are what a pasted document address is full of. */
export function counterpartyAddressLine(json: unknown): string {
  return counterpartyAddressText(json).replace(/\s+/g, ' ').trim();
}

export function counterpartyBranchCodeDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, COUNTERPARTY_BRANCH_CODE_LENGTH);
}

export function counterpartyFormValues(detail: CounterpartyDetail | null): CounterpartyFormValues {
  const address = counterpartyAddress(detail?.billingAddressJson);
  const branchCode = counterpartyBranchCodeDigits(detail?.branchCode ?? '');
  return {
    displayName: detail?.displayName ?? '',
    legalName: detail?.legalName ?? '',
    taxId: detail?.taxId ?? '',
    entityKind: detail?.entityKind ?? '',
    // CON-8: '00000' is head office, so it is not a branch even though the column holds a code.
    isBranch: branchCode.length > 0 && branchCode !== '00000',
    branchCode,
    addressText: address.addressText,
    postalCode: address.postalCode,
    locked: address.locked,
    email: detail?.email ?? '',
    phone: detail?.phone ?? '',
  };
}

/**
 * §8: every refusal names the way forward, so each issue is a message key with the fix in it. The
 * branch code stays optional — an empty one is head office, not an error (CON-8).
 */
export function counterpartyFormIssue(values: CounterpartyFormValues): CounterpartyFormIssue | null {
  if (!values.displayName.trim()) return { field: 'displayName', messageKey: 'counterparties.v_display_name_required' };
  if (values.addressText.trim().length > COUNTERPARTY_ADDRESS_MAX_LENGTH) {
    return { field: 'addressText', messageKey: 'counterparties.v_address_too_long' };
  }
  if (values.isBranch && values.branchCode.length > 0 && values.branchCode.length !== COUNTERPARTY_BRANCH_CODE_LENGTH) {
    return { field: 'branchCode', messageKey: 'counterparties.v_branch_code_invalid' };
  }
  return null;
}

/**
 * The PATCH/POST body. `type` is absent on purpose (A5) and `branchCode` is sent as '' — which the
 * API stores as null — when สำนักงานใหญ่ is picked, so switching back off a branch actually clears
 * the column instead of leaving the old code behind.
 */
export function counterpartyPayload(values: CounterpartyFormValues): Record<string, unknown> {
  return {
    displayName: values.displayName.trim(),
    legalName: values.legalName.trim(),
    taxId: values.taxId.trim(),
    // Omitted when ยังไม่ระบุ: the API takes only the two enum values, and writing a guess here
    // would decide this shop's withholding form for it (CON-7).
    ...(values.entityKind ? { entityKind: values.entityKind } : {}),
    branchCode: values.isBranch ? values.branchCode : '',
    addressText: values.addressText.trim(),
    postalCode: values.postalCode.trim(),
    locked: values.locked,
    email: values.email.trim() || null,
    phone: values.phone.trim(),
  };
}

export function counterpartyHref(companyId: string, counterpartyId: string): string {
  return `/companies/${encodeURIComponent(companyId)}/counterparties/${encodeURIComponent(counterpartyId)}`;
}

const AUTO_SAVE_TOAST_KEYS: Partial<Record<VendorCounterpartyAutoSaveResult['case'], CounterpartyAutoSaveNotice['messageKey']>> = {
  CREATE: 'counterparties.auto_save_created',
  FILL: 'counterparties.auto_save_filled',
};

/**
 * §7 cases a-d, turned into the one thing the review page shows. NOOP and SKIPPED are silence on
 * purpose: nothing happened that the reviewer did not already ask for. Case c is a hint, never a
 * toast and never a choice — the owner rejected the compare-and-choose panel in round 1 (A4).
 */
export function counterpartyAutoSaveNotice(
  result: VendorCounterpartyAutoSaveResult | null | undefined,
  options: { canReadCounterparty: boolean },
): CounterpartyAutoSaveNotice | null {
  if (!result) return null;
  // The API grants row-scoped access only to its creator or original receipt uploader.
  const mayOpen = !result.failed && result.case !== 'FAILED'
    && (options.canReadCounterparty || result.canOpenCounterparty === true);
  const counterpartyId = mayOpen && result.counterpartyId ? result.counterpartyId : null;

  // Checked before the case map: a failed write may still carry the case it was attempting, and
  // the bar is the only thing that tells the user the registry is behind the expense (§8).
  if (result.failed || result.case === 'FAILED') {
    return { kind: 'bar', messageKey: 'counterparties.auto_save_failed', counterpartyId };
  }

  const toastKey = AUTO_SAVE_TOAST_KEYS[result.case];
  if (toastKey) {
    return {
      kind: 'toast',
      messageKey: toastKey,
      params: { name: result.displayName ?? '' },
      counterpartyId,
    };
  }

  if (result.case === 'HISTORY') {
    return {
      kind: 'hint',
      messageKey: result.locked ? 'counterparties.auto_save_history_locked' : 'counterparties.auto_save_history',
      counterpartyId,
    };
  }

  return null;
}
