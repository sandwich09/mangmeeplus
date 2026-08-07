'use client';
import { Button } from '../button/Button';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  locale?: 'th' | 'en';
}

const labels = {
  th: { prev: 'ก่อนหน้า', next: 'ถัดไป', page_of: (p: number, t: number) => `หน้า ${p} จาก ${t}` },
  en: { prev: 'Previous', next: 'Next', page_of: (p: number, t: number) => `Page ${p} of ${t}` },
};

export function Pagination({ page, totalPages, onPageChange, disabled, locale = 'th' }: PaginationProps) {
  const l = labels[locale];
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-3 sm:flex-nowrap">
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {l.prev}
      </Button>
      <span className="text-sm text-gray-600">{l.page_of(page, totalPages)}</span>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        {l.next}
      </Button>
    </div>
  );
}
