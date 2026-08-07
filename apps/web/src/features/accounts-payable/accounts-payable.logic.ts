export const ACCOUNTS_PAYABLE_TABS = ['bills', 'payments', 'wht', 'aging'] as const;
export type AccountsPayableTab = (typeof ACCOUNTS_PAYABLE_TABS)[number];

/**
 * The bill and payment panels both have secondary cross-panel actions, but each
 * tab is usable only when its own primary GET is allowed. AP Aging has its own
 * report permission and must not inherit either transaction-list permission.
 */
const ACCOUNTS_PAYABLE_TAB_PERMISSIONS: Record<AccountsPayableTab, readonly string[]> = {
  bills: ['procurement.vendor_bill.read'],
  payments: ['procurement.supplier_payment.read'],
  // Deliberately NOT a `thai_tax` permission: a company that never bought Tax still withholds tax
  // and still owes its payee a 50 ทวิ, so this panel must stay reachable for it.
  wht: ['wht.certificate.read'],
  aging: ['procurement.ap.report'],
};

export function visibleAccountsPayableTabs(permissions: readonly string[]): AccountsPayableTab[] {
  return ACCOUNTS_PAYABLE_TABS.filter((tab) =>
    ACCOUNTS_PAYABLE_TAB_PERMISSIONS[tab].some((key) => permissions.includes(key)),
  );
}

/** Unknown or hidden `?tab=` values fall back to the first panel this session can load. */
export function parseAccountsPayableTab(
  value: string | null | undefined,
  visible: readonly AccountsPayableTab[] = ACCOUNTS_PAYABLE_TABS,
): AccountsPayableTab {
  return visible.includes(value as AccountsPayableTab)
    ? (value as AccountsPayableTab)
    : (visible[0] ?? 'bills');
}

/**
 * How the 50 ทวิ handoff panel should react to a failed link.
 *
 * Kept pure and separate from the component so each branch is testable. `reload` matters as much as
 * the message: when the server says the handoff is already linked, the list on screen is stale and
 * showing an error without refreshing leaves the operator staring at a row that no longer reflects
 * reality — usually their own second submit, or a colleague who linked it first.
 */
export type WhtLinkErrorOutcome = { message: string; reload: boolean };

export function whtLinkErrorOutcome(error: unknown): WhtLinkErrorOutcome {
  const code = (error as { code?: unknown } | null)?.code;
  // Two error shapes reach this: `authedApiFetch` (what the AP screens actually use) throws an
  // Error carrying `status`, while `ApiError` from the HttpClient path exposes `statusCode`.
  // Reading only one of them silently disabled every status-based branch below.
  const raw = error as { statusCode?: unknown; status?: unknown } | null;
  const status = raw?.statusCode ?? raw?.status;

  switch (code) {
    case 'wht_handoff_already_linked':
      return { message: 'หนังสือรับรองนี้ถูกแนบไว้แล้ว — กำลังโหลดข้อมูลล่าสุด', reload: true };
    case 'wht_handoff_link_command_reused':
      return { message: 'รหัสคำสั่งนี้ถูกใช้กับข้อมูลชุดอื่นแล้ว กรุณาเริ่มรายการใหม่', reload: true };
    case 'wht_handoff_not_linkable':
      return { message: 'สถานะของงานนี้ไม่รองรับการแนบเอกสาร', reload: true };
    default:
      break;
  }
  if (status === 400 || status === 422) {
    return { message: 'ข้อมูลไม่ครบหรือไม่ถูกต้อง กรุณาตรวจสอบเลขที่หนังสือรับรอง หลักฐาน และวันที่', reload: false };
  }
  if (status === 403) {
    return { message: 'ไม่มีสิทธิ์แนบหนังสือรับรอง', reload: false };
  }
  if (status === 404) {
    return { message: 'ไม่พบรายการนี้แล้ว — กำลังโหลดข้อมูลล่าสุด', reload: true };
  }
  const message = (error as { message?: unknown } | null)?.message;
  return { message: typeof message === 'string' && message ? message : 'ไม่สามารถแนบหนังสือรับรองได้', reload: false };
}
