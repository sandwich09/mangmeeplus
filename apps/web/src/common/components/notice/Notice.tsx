import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

export type NoticeTone = 'error' | 'warning' | 'info' | 'success';

/** The mark is text, so a tone is never told by colour alone and a test can read the notice as one sentence. */
const TONE: Record<NoticeTone, { border: string; surface: string; text: string; mark: string }> = {
  error: { border: 'border-[#FECDCA]', surface: 'bg-error-50', text: 'text-error-700', mark: '⚠ ' },
  warning: { border: 'border-warning-100', surface: 'bg-warning-50', text: 'text-warning-700', mark: '⚠ ' },
  info: { border: 'border-[#D6E2F3]', surface: 'bg-[var(--color-info-surface)]', text: 'text-[var(--color-info-text)]', mark: '' },
  success: { border: 'border-brand-100', surface: 'bg-success-50', text: 'text-success-700', mark: '✓ ' },
};

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  /** `error` is announced at once (`role="alert"`); the others wait their turn (`role="status"`). */
  tone?: NoticeTone;
  /** One button or link: the way out of a refusal, on the same line as the sentence (below it on a phone). */
  action?: ReactNode;
  /** Replaces the tone's own mark, for example `'🔒 '` on a not-allowed notice. */
  mark?: string;
}

/**
 * The one look for a notice on a page: what happened, in one sentence, with at most one action
 * (thai-ux-standard §1.6, §6). Errors, warnings, notes and done-messages all use it.
 *
 * ```tsx
 * <Notice tone="error" action={<Link className={secondaryButtonClass} href={profile}>กรอกข้อมูลร้าน</Link>}>
 *   ออกหนังสือรับรองไม่ได้ เพราะยังไม่มีเลขผู้เสียภาษีของร้าน
 * </Notice>
 * ```
 */
export const Notice = forwardRef<HTMLDivElement, NoticeProps>(function Notice(
  { tone = 'info', action, mark, className, children, ...rest },
  ref,
) {
  const look = TONE[tone];
  const sign = mark ?? look.mark;
  return (
    <div
      {...rest}
      ref={ref}
      role={tone === 'error' ? 'alert' : 'status'}
      data-tone={tone}
      className={[
        `rounded-xl border ${look.border} ${look.surface} px-4 py-3 text-sm font-medium ${look.text}`,
        action ? 'flex flex-wrap items-center gap-x-4 gap-y-2' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
    >
      {action ? (
        <>
          <div className="min-w-0 flex-1 basis-64">{sign}{children}</div>
          <div className="shrink-0">{action}</div>
        </>
      ) : (
        <>{sign}{children}</>
      )}
    </div>
  );
});
