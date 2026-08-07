import type { ReactNode } from 'react';

export type BadgeVariant = 'ready' | 'planned' | 'neutral';

export type BadgeProps = {
  children: ReactNode;
  variant?: BadgeVariant;
};
