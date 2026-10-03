// "แสดงเมนูบันทึกด้วยมือบนเว็บ" on the web (manual-expense-web-entry-flag spec §6.2, §7.1).
//
// A screen setting, not an authority: the API still decides who may create an expense, and
// `expenseCapabilities().canCreate` keeps its meaning for the wizard, upload and every other flow.

type EntrySession = { companyId: string; permissions: readonly string[]; manualExpenseWebEntry?: boolean };

/**
 * The company's setting alone, for the one screen that is not about the reader's permission (the
 * guide's note).
 *
 * `!== false` on purpose. The API decides what a company without a stored value reads as and always
 * answers a boolean; a value that is MISSING here means an older API or a glitch, and that must not
 * take the page away from a shop that has it switched on.
 */
export function manualExpenseWebEntryShown(session: { manualExpenseWebEntry?: boolean } | null | undefined): boolean {
  return session?.manualExpenseWebEntry !== false;
}

/**
 * The one predicate behind every web entrance to the manual expense page: the sidebar item, the
 * buttons and cards that link to it, the guide's shortcut and the page's own admission.
 */
export function canOpenManualWeb(session: EntrySession | null | undefined, companyId: string): boolean {
  return session?.companyId === companyId
    && session.permissions.includes('expense.create')
    && manualExpenseWebEntryShown(session);
}

/**
 * Admission to the manual page is a state of the mounted page, not a server refusal (spec §7.1):
 * taken as soon as the entrance is shown, and never withdrawn while the page stays mounted, so a
 * form in progress survives the admin switching the menu off. Leaving the page, reloading it or
 * opening a new tab starts again from the value the server sends.
 */
export function nextManualEntryAdmission(admitted: boolean, open: boolean): boolean {
  return admitted || open;
}

/** What the manual tab renders: the form, the form with the "closed, you may finish" note, or the not-enabled state. */
export function manualEntryView(admitted: boolean, open: boolean): 'form' | 'form_closed' | 'not_enabled' {
  if (!admitted) return 'not_enabled';
  return open ? 'form' : 'form_closed';
}
