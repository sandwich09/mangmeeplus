import type { BadgeProps } from './Badge.model';
import styles from './Badge.module.css';

export function Badge({ children, variant = 'neutral' }: BadgeProps) {
  return <span className={`${styles.badge} ${styles[variant]}`}>{children}</span>;
}
