'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from '@/common/components/button';

export interface ConfirmRequest {
  message: ReactNode;
  title?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' for destructive actions (default), 'primary' for neutral ones. */
  variant?: 'danger' | 'primary';
}

type PendingRequest = ConfirmRequest & { resolve: (answer: boolean) => void };

/** The safe button when the caller names none. `ปิด`, not `ยกเลิก`: a confirmation that voids something (`ยกเลิกเอกสาร`) must never show two ยกเลิก. */
const FALLBACK_SAFE_LABEL = 'ปิด';

/**
 * Themed replacement for window.confirm(): keeps the same `if (!(await confirm(...))) return;`
 * control flow, but renders the app's own Modal instead of the browser dialog.
 *
 * Name the thing in the title, say the consequence in one sentence, and name both outcomes on
 * the buttons (thai-ux-standard §4.2); the defaults ยืนยัน / ปิด are only a fallback. The two
 * buttons come out one width, the one that backs out first, by the Modal footer's own rule.
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirm();
 * // in a handler:
 * // if (!(await confirm({ title: 'ลบไฟล์ ใบเสร็จ.jpg', message: 'ลบแล้วกู้คืนไม่ได้', confirmLabel: 'ลบไฟล์', cancelLabel: 'ไม่ลบ' }))) return;
 * // in the JSX:   {confirmDialog}
 * ```
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingRequest | null>(null);

  const confirm = useCallback(
    (request: ConfirmRequest | string) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...(typeof request === 'string' ? { message: request } : request), resolve });
      }),
    [],
  );

  // A pending promise the caller is awaiting must settle on every exit path — confirm, cancel,
  // backdrop click and Escape all route through onClose/onCancel below.
  const settle = (answer: boolean) => {
    pending?.resolve(answer);
    setPending(null);
  };

  const confirmDialog = (
    <Modal
      open={pending !== null}
      title={pending?.title ?? 'ยืนยัน'}
      size="sm"
      closeLabel={pending?.cancelLabel ?? FALLBACK_SAFE_LABEL}
      onClose={() => settle(false)}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={() => settle(false)}>
            {pending?.cancelLabel ?? FALLBACK_SAFE_LABEL}
          </Button>
          <Button type="button" variant={pending?.variant ?? 'danger'} onClick={() => settle(true)}>
            {pending?.confirmLabel ?? 'ยืนยัน'}
          </Button>
        </>
      )}
    >
      <p className="text-sm text-gray-600">{pending?.message}</p>
    </Modal>
  );

  return { confirm, confirmDialog };
}
