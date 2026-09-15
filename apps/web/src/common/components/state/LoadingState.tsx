'use client';

export interface LoadingStateProps {
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

const spinnerSize = { sm: 'h-5 w-5 border-2', md: 'h-8 w-8 border-4', lg: 'h-12 w-12 border-4' };
const textSize = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' };

export function LoadingState({ label, size = 'md' }: LoadingStateProps) {
  return (
    <div role="status" aria-busy="true" className="flex w-full flex-col items-center justify-center gap-3 py-12">
      <span
        aria-hidden="true"
        className={`rounded-full border-gray-200 border-t-brand-600 animate-spin ${spinnerSize[size]}`}
      />
      {label && <p className={`text-gray-500 ${textSize[size]}`}>{label}</p>}
    </div>
  );
}
