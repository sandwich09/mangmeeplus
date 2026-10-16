/** Keep a requested field and its inline error between the actual sticky bars. */
export function focusExpenseField(element: HTMLElement | null | undefined, focusTarget?: HTMLElement | null) {
  if (!element) return;
  const disclosure = element.closest('details');
  if (disclosure) disclosure.open = true;
  const field = focusTarget ?? (element.matches('input, textarea, select, button, a, [tabindex]') ? element
    : element.querySelector<HTMLElement>('[aria-invalid="true"], input:not([type="hidden"]), textarea, select, button, [role="combobox"]') ?? element);
  const rect = (element === field ? field.closest('label') ?? field : element).getBoundingClientRect();
  const header = document.querySelector('[data-app-top-bar]')?.getBoundingClientRect();
  const stepper = document.querySelector('[data-expense-stepper]')?.getBoundingClientRect();
  const dialogBody = element.closest<HTMLElement>('[data-modal-body]');
  const bodyRect = dialogBody?.getBoundingClientRect();
  const top = (bodyRect?.top ?? Math.max(0, header?.bottom ?? 0) + (stepper?.height ?? 0)) + 8;
  const bottom = (bodyRect?.bottom ?? Array.from(document.querySelectorAll('[data-form-action-bar]')).reduce((edge, bar) => {
    if (!['sticky', 'fixed'].includes(window.getComputedStyle(bar).position)) return edge;
    const bounds = bar.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.top < window.innerHeight ? Math.min(edge, bounds.top) : edge;
  }, window.innerHeight)) - 8;
  const offset = rect.top < top || rect.height > bottom - top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
  if (offset) (dialogBody ?? window).scrollBy({ top: offset, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  if (!field.matches('input, textarea, select, button, a, [tabindex]')) field.tabIndex = -1;
  field.focus({ preventScroll: true });
}
