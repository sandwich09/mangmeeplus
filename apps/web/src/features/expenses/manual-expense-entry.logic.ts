// "แสดงเมนูบันทึกด้วยมือบนเว็บ" on the web (manual-expense-web-entry-flag spec §6.2).
//
// A screen setting, not an authority: the API still decides who may create an expense, and
// `expenseCapabilities().canCreate` keeps its meaning for the wizard, upload and every other flow.

type EntrySession = { companyId: string; permissions: readonly string[]; manualExpenseWebEntry?: boolean };

/**
 * The one predicate behind every web entrance to the manual expense page: the sidebar item, the
 * buttons and cards that link to it, the guide's shortcut and the page's own admission.
 *
 * `!== false` on purpose. The API decides what a company without a stored value reads as and always
 * answers a boolean; a value that is MISSING here means an older API or a glitch, and that must not
 * take the page away from a shop that has it switched on.
 */
export function canOpenManualWeb(session: EntrySession | null | undefined, companyId: string): boolean {
  return session?.companyId === companyId
    && session.permissions.includes('expense.create')
    && session.manualExpenseWebEntry !== false;
}
