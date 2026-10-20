'use client';

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { MoreDotIcon } from '@/common/icons';
import { quietButtonClass, secondaryButtonClass } from '../button/button-classes';
import styles from './MoreActions.module.css';

export interface MoreActionsProps {
  label: string;
  children: ReactNode;
  variant?: 'text' | 'icon';
  busy?: boolean;
  /** `end` hangs the list from the button's right edge, including phone header rows. */
  align?: 'start' | 'end';
  /** `up` opens the list above the button, for a menu that sits in a bar at the bottom of the screen. Default `down`. */
  opens?: 'down' | 'up';
  /** Close the list when one of its buttons or links is pressed. Off by default: an entry that shows its own "working" state stays in view. */
  closeOnPress?: boolean;
}

/**
 * Two or more rare actions behind one compact button (thai-ux-standard §2.7). A native disclosure
 * keeps it keyboard accessible; the open list floats over the page like a menu, a press anywhere
 * else closes it, and Escape closes it and returns to the button.
 *
 * ```tsx
 * <MoreActions label="เพิ่มเติม" opens="up" closeOnPress>
 *   <button type="button" className={secondaryButtonClass} onClick={voidDocument}>ยกเลิกเอกสาร</button>
 *   <button type="button" className={secondaryButtonClass} onClick={reject}>ปฏิเสธ</button>
 * </MoreActions>
 * ```
 */
export function MoreActions({ label, children, align = 'start', opens = 'down', closeOnPress = false, variant = 'text', busy }: MoreActionsProps) {
  const place = (menu: HTMLDetailsElement) => {
    if (!menu.open) return;
    const panel = menu.querySelector<HTMLElement>(`.${styles.panel}`);
    if (!panel) return;
    panel.style.setProperty('--panel-shift-x', '0px');
    const rect = panel.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 8;
    panel.style.setProperty('--panel-shift-x', `${Math.max(left, Math.min(rect.left, right - rect.width)) - rect.left}px`);
  };
  const watchPanel = (panel: HTMLDivElement | null) => {
    if (!panel) return;
    const menu = panel.parentElement as HTMLDetailsElement;
    const reposition = () => place(menu);
    // Fonts and wrapping can change the panel or trigger after the opening toggle.
    const observer = new ResizeObserver(reposition);
    observer.observe(panel);
    observer.observe(menu);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
    };
  };
  const pressed = (event: MouseEvent<HTMLDetailsElement>) => {
    if (!closeOnPress) return;
    const entry = (event.target as Element).closest('a, button');
    if (entry && entry.closest(`.${styles.panel}`)) {
      event.currentTarget.open = false;
      if (variant === 'icon') event.currentTarget.querySelector('summary')?.focus();
    }
  };
  const keyed = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== 'Escape' || !event.currentTarget.open) return;
    event.stopPropagation(); // the menu closes; a dialog around it stays
    event.currentTarget.open = false;
    event.currentTarget.querySelector('summary')?.focus();
  };
  return <details className={[styles.menu, variant === 'icon' ? styles.icon : '', align === 'end' ? styles.end : '', opens === 'up' ? styles.up : ''].filter(Boolean).join(' ')} onClick={pressed} onKeyDown={keyed} onToggle={event => place(event.currentTarget)}>
    <summary className={variant === 'icon' ? quietButtonClass : secondaryButtonClass} aria-label={variant === 'icon' ? label : undefined} aria-busy={busy}>{variant === 'icon' ? <MoreDotIcon aria-hidden="true" className="h-5 w-5" /> : label}</summary>
    <div ref={watchPanel} className={styles.panel}>{children}</div>
  </details>;
}
