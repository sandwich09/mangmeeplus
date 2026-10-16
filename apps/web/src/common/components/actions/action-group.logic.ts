export type ActionLayout = 'row' | 'stack';

export interface ActionLayoutInput {
  /** Width the group may take, in px. */
  available: number;
  /** Width each button needs to show its name on one line, in px, in DOM order. */
  naturals: readonly number[];
  /** Space between two buttons, in px. */
  gap?: number;
  /** Narrowest a column may be, in px (8rem from 640 px; none on a phone, where the columns fill the width). */
  minColumn?: number;
  /** Most buttons that may share a row (three on a phone). */
  maxColumns?: number;
}

/**
 * Buttons that sit together are one width (thai-ux-standard §2.3): side by side when every one
 * can be as wide as the longest name, stacked at one width when they cannot. A name never wraps
 * inside a narrow button, and a short button never sits beside a long one.
 */
export function decideActionLayout({ available, naturals, gap = 8, minColumn = 0, maxColumns = Infinity }: ActionLayoutInput): ActionLayout {
  const count = naturals.length;
  if (count < 2) return 'row';
  if (count > maxColumns) return 'stack';
  const column = Math.max(minColumn, ...naturals);
  return column * count + gap * (count - 1) <= available ? 'row' : 'stack';
}
