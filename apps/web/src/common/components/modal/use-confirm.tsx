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

/**
 * Themed replacement for window.confirm(): keeps the same `if (!(await confirm(...))) return;`
 * control flow, but renders the app's own Modal instead of the browser dialog.
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirm();
 * // in a handler: if (!(await confirm('ลบรายการนี้ใช่หรือไม่?'))) return;
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
      closeLabel={pending?.cancelLabel ?? 'ยกเลิก'}
      onClose={() => settle(false)}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={() => settle(false)}>
            {pending?.cancelLabel ?? 'ยกเลิก'}
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
