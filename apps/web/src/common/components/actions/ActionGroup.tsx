'use client';

import { useRef, type HTMLAttributes } from 'react';
import { useActionGroupLayout } from './use-action-group-layout';

export interface ActionGroupProps extends HTMLAttributes<HTMLDivElement> {
  /** Where a compact group sits from 640 px: at the right (default), at the left, or in the middle (an empty state, a centred card). A phone always fills the width. */
  align?: 'end' | 'start' | 'center';
}

/**
 * Buttons that sit together (thai-ux-standard §2.3, §2.4): one height, one width, one order.
 *
 * Put the buttons in as direct children, **the one that backs out first and the one that acts
 * last**. They sit side by side in equal columns when every name fits, with the acting button at
 * the right; when the names do not fit they stack at one width with the acting button on top.
 * The look is `.mangmee-actions` in app/globals.css.
 *
 * ```tsx
 * <ActionGroup>
 *   <button type="button" className={secondaryButtonClass} onClick={onClose}>ไม่ลบ</button>
 *   <button type="button" className={dangerButtonClass} onClick={remove}>ลบไฟล์</button>
 * </ActionGroup>
 * ```
 *
 * A `Modal` footer does this by itself when its footer is plain buttons: do not wrap them.
 */
export function ActionGroup({ align, className, children, ...rest }: ActionGroupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const layout = useActionGroupLayout(ref);
  return (
    <div {...rest} ref={ref} data-layout={layout} data-align={align} className={className ? `mangmee-actions ${className}` : 'mangmee-actions'}>
      {children}
    </div>
  );
}
