'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from '@/common/components/mangmee';

// Themed horizontal step indicator — one design for every wizard in the app.
// Node language: done = brand square with a check, current = brand square with an
// inner white square + halo ring, upcoming = outlined square with a gray square,
// attention = warning outline (a step that needs the user to come back).
// The connector into a node is brand once the previous step is done; the connector
// out of the current step fades brand→gray to read as "in progress".

export type ThemedStepState = 'done' | 'current' | 'upcoming' | 'attention';

export type ThemedStep = {
  key: string;
  label: ReactNode;
  description?: ReactNode;
  state: ThemedStepState;
  /** Renders the step as a link (e.g. querystring-routed wizards). */
  href?: string;
  /** Renders the step as a button. Ignored when `href` is set. */
  onSelect?: () => void;
  disabled?: boolean;
};

function StepNode({ state }: { state: ThemedStepState }) {
  if (state === 'attention') {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-warning-500 bg-warning-50 text-base text-warning-700">
        ⚠
      </span>
    );
  }
  if (state === 'upcoming') {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-[1.5px] border-gray-200 bg-white">
        <span className="h-3 w-3 rounded-[4px] bg-gray-300" />
      </span>
    );
  }
  return (
    <span className={cx(
      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white',
      state === 'current' && 'ring-4 ring-brand-100',
    )}>
      {state === 'done' ? (
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
          <path d="m5 10.5 3.5 3.5L15 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <span className="h-3 w-3 rounded-[4px] bg-white" />
      )}
    </span>
  );
}

export function ThemedSteps({ steps, className, 'aria-label': ariaLabel }: {
  steps: ThemedStep[];
  className?: string;
  'aria-label'?: string;
}) {
  // Connector halves live per column so labels stay centered under their node; the
  // half AFTER a node keys off that node's state, the half BEFORE keys off the
  // previous node — together they draw one continuous segment.
  const lineAfter = (state: ThemedStepState) =>
    state === 'done' ? 'bg-brand-500'
      : state === 'current' ? 'bg-linear-to-r from-brand-500 to-gray-200'
        : 'bg-gray-200';
  const lineBefore = (state: ThemedStepState) => (state === 'done' ? 'bg-brand-500' : 'bg-gray-200');

  return (
    <nav aria-label={ariaLabel} className={cx('w-full', className)}>
      <ol className="flex w-full items-start">
        {steps.map((step, index) => {
          const body = (
            <>
              <StepNode state={step.state} />
              <span className="flex flex-col items-center gap-0.5 px-1 text-center">
                <span className={cx(
                  'text-[11px] font-bold leading-tight sm:text-xs',
                  step.state === 'upcoming' ? 'text-gray-400'
                    : step.state === 'attention' ? 'text-warning-700'
                      : 'text-gray-900',
                )}>
                  {step.label}
                </span>
                {step.description && <span className="text-[10px] leading-tight text-gray-400 sm:text-[11px]">{step.description}</span>}
              </span>
            </>
          );
          const interactiveClass = 'relative z-10 flex flex-col items-center gap-2 disabled:cursor-not-allowed';
          const ariaCurrent = step.state === 'current' ? ('step' as const) : undefined;
          return (
            <li key={step.key} className="relative flex min-w-0 flex-1 flex-col items-center">
              {index > 0 && (
                <span aria-hidden="true" className={cx('absolute left-0 top-5 h-0.5 w-[calc(50%-1.625rem)] -translate-y-1/2 rounded-full', lineBefore(steps[index - 1]!.state))} />
              )}
              {index < steps.length - 1 && (
                <span aria-hidden="true" className={cx('absolute right-0 top-5 h-0.5 w-[calc(50%-1.625rem)] -translate-y-1/2 rounded-full', lineAfter(step.state))} />
              )}
              {step.href ? (
                <Link href={step.href} aria-current={ariaCurrent} className={interactiveClass}>{body}</Link>
              ) : step.onSelect ? (
                <button type="button" disabled={step.disabled} onClick={step.onSelect} aria-current={ariaCurrent} className={interactiveClass}>{body}</button>
              ) : (
                <span aria-current={ariaCurrent} className="relative z-10 flex flex-col items-center gap-2">{body}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
