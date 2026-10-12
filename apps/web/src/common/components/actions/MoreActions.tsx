import type { ReactNode } from 'react';
import styles from './MoreActions.module.css';

/**
 * Secondary actions behind one compact button. A native disclosure keeps it keyboard accessible;
 * the open list floats over the page like a menu, and a press anywhere else closes it.
 * `align="end"` hangs the list from the button's right edge (for a button at the right of a header).
 */
export function MoreActions({ label, children, align = 'start' }: { label: string; children: ReactNode; align?: 'start' | 'end' }) {
  return <details className={align === 'end' ? `${styles.menu} ${styles.end}` : styles.menu}>
    <summary>{label}</summary>
    <div className={styles.panel}>{children}</div>
  </details>;
}
