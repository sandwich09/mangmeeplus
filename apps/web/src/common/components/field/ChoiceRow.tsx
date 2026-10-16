import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';

/** The brand radio / tick on a bare `<input type="radio|checkbox">` (a table cell, a tick with no row of its own). */
export const choiceInputClass = 'mangmee-choice-input';

export interface ChoiceRowProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  /** `radio` (default): one of several, give them one `name`. `checkbox`: a tick on its own. */
  type?: 'radio' | 'checkbox';
  label: ReactNode;
  /** One line under the label: what choosing this means. */
  description?: ReactNode;
  /** Draw each choice in its own box; the chosen one is marked by the box as well as by the dot. */
  framed?: boolean;
  /** Classes for the row (margins, width). The input itself takes every other prop. */
  className?: string;
}

/**
 * One choice in a list of choices (send to whom, which reason, which signature): a real
 * `<input type="radio|checkbox">` drawn in the brand look, its label beside it, the whole row a
 * 44 px target (thai-ux-standard §6.4). Forms, `required`, `name`/`value` and the keyboard work as
 * with any input, because it is one.
 *
 * ```tsx
 * <fieldset><legend className="text-sm font-semibold">ส่งให้ใครอนุมัติ</legend>
 *   {people.map(p => <ChoiceRow key={p.id} name="approver" value={p.id} label={p.name} description={p.jobTitle}
 *     checked={approver === p.id} onChange={() => setApprover(p.id)} />)}
 * </fieldset>
 * ```
 */
export const ChoiceRow = forwardRef<HTMLInputElement, ChoiceRowProps>(function ChoiceRow(
  { type = 'radio', label, description, framed = false, className, ...input },
  ref,
) {
  return (
    <label data-framed={framed || undefined} className={className ? `mangmee-choice ${className}` : 'mangmee-choice'}>
      <input {...input} ref={ref} type={type} className={choiceInputClass} />
      <span className="mangmee-choice-text">
        <span className="mangmee-choice-label">{label}</span>
        {description && <span className="mangmee-choice-description">{description}</span>}
      </span>
    </label>
  );
});
