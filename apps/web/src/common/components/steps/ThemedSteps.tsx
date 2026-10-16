'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from '@/common/components/mangmee';

// Themed horizontal step indicator — one design for every wizard in the app.
// สรรพากร-style numbered circles that track position, not completion memory:
// every step at or before the current one is brand green with its number, every
// step after it is gray — stepping back grays the steps ahead again. The current
// node carries a halo ring + aria-current; attention = warning outline (a step
// that needs the user to come back). Connectors are brand only behind a passed step.

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

function StepNode({ state, number }: { state: ThemedStepState; number: number }) {
  if (state === 'attention') {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-warning-500 bg-warning-50 text-base text-warning-700">
        ⚠
      </span>
    );
  }
  if (state === 'upcoming') {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-gray-200 bg-white text-base font-bold text-gray-400">
        {number}
      </span>
    );
  }
  return (
    <span className={cx(
      'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-base font-bold text-white',
      state === 'current' && 'ring-4 ring-brand-100',
    )}>
      {number}
    </span>
  );
}

export function ThemedSteps({ steps, className, 'aria-label': ariaLabel, onStepPress }: {
  steps: ThemedStep[];
  className?: string;
  'aria-label'?: string;
  /**
   * Going back a step: when given, every finished (`done`) step is one real button (circle and
   * name together) that calls this with its position; the current and the coming steps stay plain.
   * A step with its own `href` or `onSelect` keeps that. With no handler nothing changes.
   */
  onStepPress?: (index: number, step: ThemedStep) => void;
}) {
  // Connector halves live per column so labels stay centered under their node; the
  // half AFTER a node keys off that node's state, the half BEFORE keys off the
  // previous node — together they draw one continuous segment, brand only when the
  // node behind it is passed (the current node's outbound segment stays gray).
  const segment = (state: ThemedStepState) => (state === 'done' ? 'bg-brand-500' : 'bg-gray-200');

  return (
    <nav aria-label={ariaLabel} className={cx('w-full', className)}>
      <ol className="flex w-full items-start">
        {steps.map((step, index) => {
          const body = (
            <>
              <StepNode state={step.state} number={index + 1} />
              <span className="flex w-full min-w-0 flex-col items-center gap-0.5 px-1 text-center">
                <span className={cx(
                  // 12px and room between lines: a step name wraps under a narrow circle, and at 11px / 1.25 its marks met.
                  'max-w-full text-xs font-bold leading-[1.6] [overflow-wrap:anywhere]',
                  step.state === 'upcoming' ? 'text-gray-400'
                    : step.state === 'attention' ? 'text-warning-700'
                      : 'text-gray-900',
                )}>
                  {step.label}
                </span>
                {step.description && <span className="max-w-full text-xs leading-normal text-gray-500 [overflow-wrap:anywhere]">{step.description}</span>}
              </span>
            </>
          );
          const interactiveClass = 'relative z-10 flex w-full min-w-0 flex-col items-center gap-2 disabled:cursor-not-allowed';
          const ariaCurrent = step.state === 'current' ? ('step' as const) : undefined;
          return (
            <li key={step.key} className="relative flex min-w-0 flex-1 flex-col items-center">
              {index > 0 && (
                <span aria-hidden="true" className={cx('absolute left-0 top-5 h-0.5 w-[calc(50%-1.625rem)] -translate-y-1/2 rounded-full', segment(steps[index - 1]!.state))} />
              )}
              {index < steps.length - 1 && (
                <span aria-hidden="true" className={cx('absolute right-0 top-5 h-0.5 w-[calc(50%-1.625rem)] -translate-y-1/2 rounded-full', segment(step.state))} />
              )}
              {step.href ? (
                <Link href={step.href} aria-current={ariaCurrent} className={interactiveClass}>{body}</Link>
              ) : step.onSelect ? (
                <button type="button" disabled={step.disabled} onClick={step.onSelect} aria-current={ariaCurrent} className={interactiveClass}>{body}</button>
              ) : onStepPress && step.state === 'done' ? (
                // The whole column is the target (never under 44 px), with a ring the keyboard can see; the name underlines under a cursor.
                <button type="button" data-step-back disabled={step.disabled} onClick={() => onStepPress(index, step)}
                  className={cx(interactiveClass, 'min-h-11 min-w-11 cursor-pointer rounded-lg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600')}>{body}</button>
              ) : (
                <span aria-current={ariaCurrent} className="relative z-10 flex w-full min-w-0 flex-col items-center gap-2">{body}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
