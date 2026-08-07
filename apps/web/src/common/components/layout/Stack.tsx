import type { StackProps } from './Stack.model';
import styles from './Stack.module.css';

const gapClass = {
  1: styles.gap1,
  2: styles.gap2,
  3: styles.gap3,
  4: styles.gap4,
  5: styles.gap5,
};

const alignClass = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd,
  stretch: styles.alignStretch,
};

const justifyClass = {
  start: styles.justifyStart,
  center: styles.justifyCenter,
  between: styles.justifyBetween,
  end: styles.justifyEnd,
};

export function Stack({
  children,
  direction = 'column',
  gap = 3,
  align = 'stretch',
  justify = 'start',
  wrap = false,
  className,
}: StackProps) {
  const classes = [
    styles.stack,
    styles[direction],
    gapClass[gap],
    alignClass[align],
    justifyClass[justify],
    wrap ? styles.wrap : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return <div className={classes}>{children}</div>;
}
