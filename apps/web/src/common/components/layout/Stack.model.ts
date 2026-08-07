import type { ReactNode } from 'react';

export type StackDirection = 'row' | 'column';

export type StackAlign = 'start' | 'center' | 'end' | 'stretch';

export type StackJustify = 'start' | 'center' | 'between' | 'end';

export type StackGap = 1 | 2 | 3 | 4 | 5;

export type StackProps = {
  children: ReactNode;
  direction?: StackDirection;
  gap?: StackGap;
  align?: StackAlign;
  justify?: StackJustify;
  wrap?: boolean;
  className?: string;
};
