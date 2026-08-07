'use client';

import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from '@/common/components/button';

export interface AlertModalProps {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  onClose: () => void;
  /** Label for both the header close button and the dismiss button. */
  closeLabel?: string;
}

/** Themed replacement for window.alert(): one message, one dismiss button. */
export function AlertModal({ open, title, message, onClose, closeLabel = 'ปิด' }: AlertModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      size="sm"
      closeLabel={closeLabel}
      onClose={onClose}
      footer={<Button type="button" onClick={onClose}>{closeLabel}</Button>}
    >
      <p className="text-sm text-gray-600">{message}</p>
    </Modal>
  );
}
