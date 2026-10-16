/**
 * The one look of button (docs/guidelines/thai-ux-standard.md §2). Four variants, drawn by the
 * `.mangmee-btn*` rules in app/globals.css: 44 px tall on a phone, 40 px from 640 px, with the same
 * hover, focus, disabled and busy states on a `<button>` and on an `<a>`.
 *
 * Use these strings on a native `<button>` / `<a>` / `<Link>`, or render `<Button variant>`; both
 * give the same button. Do not add colour, height, radius, weight or padding utilities next to
 * them: the rules are plain CSS and win over utilities on purpose.
 */
export type ButtonLook = 'primary' | 'secondary' | 'quiet' | 'danger';

/** The one main action of a view (a dialog is its own view). */
export const primaryButtonClass = 'mangmee-btn mangmee-btn-primary';
/** Every other action, including the button that backs out. */
export const secondaryButtonClass = 'mangmee-btn mangmee-btn-secondary';
/** A low-key action with no frame (a pager, "show more"). */
export const quietButtonClass = 'mangmee-btn mangmee-btn-quiet';
/** Delete, void, sign out: pale red, so it is read before it is pressed. */
export const dangerButtonClass = 'mangmee-btn mangmee-btn-danger';

export const buttonClassByLook: Record<ButtonLook, string> = {
  primary: primaryButtonClass,
  secondary: secondaryButtonClass,
  quiet: quietButtonClass,
  danger: dangerButtonClass,
};
