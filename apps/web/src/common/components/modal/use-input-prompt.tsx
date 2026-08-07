'use client';

import { useCallback, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from '@/common/components/button';

export interface InputPromptRequest {
  title?: ReactNode;
  message?: ReactNode;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  required?: boolean;
  multiline?: boolean;
  inputMode?: 'text' | 'numeric';
  initialValue?: string;
}

type PendingRequest = InputPromptRequest & { resolve: (value: string | null) => void };

export function renderInputPromptContent(
  request: InputPromptRequest,
  value: string,
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void,
  settle: (value: string | null) => void,
) {
  const required = request.required ?? true;
  const fieldProps = {
    'aria-label': request.label,
    className: 'mangmee-input w-full',
    inputMode: request.inputMode ?? 'text',
    placeholder: request.placeholder,
    required,
    value,
    onChange,
  };

  return {
    body: (
      <div className="space-y-3">
        {request.message && <p className="text-sm text-gray-600">{request.message}</p>}
        <label className="block text-sm font-medium text-gray-700">
          {request.label}
          {request.multiline ?? true
            ? <textarea {...fieldProps} className={`${fieldProps.className} mt-1`} rows={3} />
            : <input {...fieldProps} className={`${fieldProps.className} mt-1`} />}
        </label>
      </div>
    ),
    footer: (
      <>
        <Button type="button" variant="secondary" onClick={() => settle(null)}>
          {request.cancelLabel ?? 'ยกเลิก'}
        </Button>
        <Button
          type="button"
          variant={request.variant ?? 'danger'}
          disabled={required && !value.trim()}
          onClick={() => settle(value.trim())}
        >
          {request.confirmLabel ?? 'ยืนยัน'}
        </Button>
      </>
    ),
  };
}

export function useInputPrompt() {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [value, setValue] = useState('');

  const promptInput = useCallback(
    (request: InputPromptRequest) =>
      new Promise<string | null>((resolve) => {
        setValue(request.initialValue ?? '');
        setPending({ ...request, resolve });
      }),
    [],
  );

  const settle = (answer: string | null) => {
    pending?.resolve(answer);
    setPending(null);
    setValue('');
  };

  const content = pending
    ? renderInputPromptContent(pending, value, (event) => setValue(event.target.value), settle)
    : null;
  const inputPromptDialog = (
    <Modal
      open={pending !== null}
      title={pending?.title ?? 'กรอกข้อมูล'}
      size="sm"
      closeLabel={pending?.cancelLabel ?? 'ยกเลิก'}
      onClose={() => settle(null)}
      footer={content?.footer}
    >
      {content?.body}
    </Modal>
  );

  return { promptInput, inputPromptDialog };
}
