import React from 'react';
import Link from 'next/link';
import { AngleRightIcon } from '../../icons';

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: React.ReactNode;
  status?: React.ReactNode;
  eyebrow?: React.ReactNode;
}

export function PageHeader({ title, description, breadcrumbs, actions, status, eyebrow }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-gray-500">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <AngleRightIcon className="h-3 w-3 shrink-0" />}
              {crumb.href ? (
                <Link href={crumb.href} className="font-medium transition-colors hover:text-brand-700">
                  {crumb.label}
                </Link>
              ) : (
                <span className="font-semibold text-gray-700">{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <div className="mangmee-eyebrow">{eyebrow}</div>}
          <div className="flex items-center gap-2">
            <h1 className="mangmee-page-title">{title}</h1>
            {status}
          </div>
          {description && <p className="mangmee-page-description">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}
