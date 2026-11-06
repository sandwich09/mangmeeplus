import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';

export function demoActionUnavailable(): ForbiddenException {
  return new ForbiddenException({ code: 'demo_action_unavailable' });
}

export async function assertNotDemoCompany(db: Pick<Prisma.TransactionClient, 'company'>, companyId: string): Promise<void> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { reportClassification: true } });
  if (company?.reportClassification === 'DEMO') throw demoActionUnavailable();
}

/** Legacy mail attempts have no tenant column. Resolve their recipient before dispatch too. */
export async function assertNotDemoEmailRecipient(db: Pick<Prisma.TransactionClient, 'company'>, recipient: string): Promise<void> {
  const company = await db.company.findFirst({
    where: { reportClassification: 'DEMO', OR: [
      { email: { equals: recipient, mode: 'insensitive' } },
      { memberships: { some: { user: { email: { equals: recipient, mode: 'insensitive' } } } } },
    ] },
    select: { id: true },
  });
  if (company) throw demoActionUnavailable();
}

// Explicit cost/outbound entry points. Keep reads and local sample-data edits usable.
const COMPANY_ACTION_PATHS = [
  /^\/billing(?:\/|$)/,
  /^\/package-change-requests(?:\/|$)/,
  /^\/settings\/employees(?:\/[^/]+\/(?:complete|credentials\/regenerate|line-link-token))?$/,
  /^\/expenses\/[^/]+\/signature-fill$/,
  /^\/ai(?:\/|$)/,
  /^\/banking\/bank-accounts\/[^/]+\/statement-imports\/extract$/,
  /^\/crm\/(?:channels|messaging-channels)(?:\/|$)/,
  /^\/crm\/conversations\/[^/]+\/ai\//,
  /^\/crm\/customers\/ai-profile-extract$/,
  /^\/crm\/campaigns\/(?:generate|[^/]+\/send)$/,
  /^\/crm\/conversations\/[^/]+\/(?:messages|auto-reply)$/,
];
const ACCOUNT_ACTION_PATHS = [
  /^\/v1\/auth\/password\/change$/,
  /^\/v1\/auth\/line\/(?:link(?:\/oauth)?|employee-link|qr\/approve)$/,
  /^\/v1\/auth\/account-merge(?:\/preview)?$/,
  /^\/v1\/auth\/account\/email(?:\/|$)/,
  /^\/v1\/auth\/me\/(?:contact|password\/set|email\/unverified)$/,
];

export function isDemoUnavailableRoute(method: string, path: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) return false;
  const clean = path.split('?')[0].replace(/\/$/, '').toLowerCase();
  const companyPath = clean.match(/^\/v1\/companies\/[^/]+(\/.*)$/)?.[1];
  return ACCOUNT_ACTION_PATHS.some(pattern => pattern.test(clean))
    || (companyPath !== undefined && COMPANY_ACTION_PATHS.some(pattern => pattern.test(companyPath)));
}
