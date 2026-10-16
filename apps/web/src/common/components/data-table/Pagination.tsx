'use client';
import { Button } from '../button/Button';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  locale?: 'th' | 'en';
  /** Bordered 44 px buttons with arrows and a bold "page x of y": a pager nobody overlooks and a thumb can hit. */
  prominent?: boolean;
}

const labels = {
  th: { prev: 'ก่อนหน้า', next: 'ถัดไป', page_of: (p: number, t: number) => `หน้า ${p} จาก ${t}` },
  en: { prev: 'Previous', next: 'Next', page_of: (p: number, t: number) => `Page ${p} of ${t}` },
};

export function Pagination({ page, totalPages, onPageChange, disabled, locale = 'th', prominent = false }: PaginationProps) {
  const l = labels[locale];
  // The two ends are one width (thai-ux-standard §2.3): "← ก่อนหน้า" is the longer name, so both take 8rem.
  const look = prominent ? { variant: 'secondary', size: 'md', className: 'min-h-11 min-w-0 whitespace-nowrap px-3 sm:min-w-32 !text-base' } as const : { variant: 'quiet', size: 'sm', className: 'min-w-24' } as const;
  return (
    <div className={prominent ? 'flex items-center justify-between gap-3 py-1' : 'flex flex-wrap items-center justify-between gap-4 py-3 sm:flex-nowrap'}>
      <Button
        {...look}
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {prominent && <span aria-hidden="true">←</span>}
        {l.prev}
      </Button>
      <span className={prominent ? 'whitespace-nowrap text-center text-base font-semibold tabular-nums text-gray-900' : 'text-sm text-gray-600'}>{l.page_of(page, totalPages)}</span>
      <Button
        {...look}
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        {l.next}
        {prominent && <span aria-hidden="true">→</span>}
      </Button>
    </div>
  );
}
