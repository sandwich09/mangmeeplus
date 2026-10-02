// "แสดงเมนูบันทึกด้วยมือบนเว็บ" — a per-company screen setting, NOT an entitlement
// (manual-expense-web-entry-flag spec §5.1). It hides or shows the web entrances to the manual
// expense page and nothing else: no guard, permission, entitlement, LINE or billing code reads it.

/**
 * What a company WITHOUT a row reads as. Owner 2026-10-02: not shown until the system admin
 * switches it on for that company. This is the one place that says so — GET /auth/me, the partner
 * detail and the admin command all read through `manualExpenseWebEntryState` — so a different
 * answer is a change to this line and to the test that pins it.
 */
export const MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW = false;

/** The value a company has, and the version the next change must name. A stored row says either value. */
export function manualExpenseWebEntryState(
  row: { manualExpenseEntryEnabled: boolean; version: number } | null | undefined,
): { enabled: boolean; version: number } {
  return row
    ? { enabled: row.manualExpenseEntryEnabled, version: row.version }
    : { enabled: MANUAL_EXPENSE_WEB_ENTRY_WITHOUT_ROW, version: 0 };
}
