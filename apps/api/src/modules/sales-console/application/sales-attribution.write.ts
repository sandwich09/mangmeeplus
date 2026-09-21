/**
 * The ONE writer of `SalesAttribution` (spec §17.1/§17.2).
 *
 * §17.2 is the whole design: one row per company, ever, written the first time money opens the
 * shop. A deal wins by being written first; a catalog purchase inside the 14-day referral window
 * writes the REFERRAL row; a renewal of either writes nothing.
 *
 * It runs INSIDE the paid-apply transaction, so the row can never disagree with the term that same
 * commit wrote. A plain function taking `tx`, exactly like `applyDealRequest` next door — a Nest
 * provider here would have to be injected into the reconciler for no behaviour.
 */
import type { SalesAttributionSource } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import {
  attributionFlags,
  bangkokDateKey,
  type AttributionIdentity,
} from '../domain/sales-attribution.logic';

export type SalesAttributionInput = {
  companyId: string;
  salesUserId: string;
  source: SalesAttributionSource;
  amountSatang: number;
  months: number | null;
  interval: string | null;
  paidAt: Date;
  sourceInvoiceId: string;
  dealRequestId?: string | null;
};

/** Bounds every anti-gaming lookup: a shop with more owners than this is a data problem, not a shop. */
const IDENTITY_SCAN_LIMIT = 50;

export async function writeSalesAttribution(tx: Prisma.TransactionClient, input: SalesAttributionInput): Promise<void> {
  // §17.2: "นับเฉพาะการชำระครั้งแรก". The unique index would refuse the insert anyway, but reading
  // first also skips every anti-gaming query for the common renewal case.
  if (await tx.salesAttribution.findUnique({ where: { companyId: input.companyId }, select: { id: true } })) return;

  const flags = await computeFlags(tx, input);
  await tx.salesAttribution.createMany({
    data: [{
      companyId: input.companyId, salesUserId: input.salesUserId, source: input.source,
      amountSatang: input.amountSatang, months: input.months, interval: input.interval, paidAt: input.paidAt,
      sourceInvoiceId: input.sourceInvoiceId, dealRequestId: input.dealRequestId ?? null,
      flags, ...(flags.length > 0 ? { flaggedAt: new Date() } : {}),
    }],
    skipDuplicates: true,
  });
}

async function computeFlags(tx: Prisma.TransactionClient, input: SalesAttributionInput): Promise<string[]> {
  const ownerUserIds = await ownerUserIdsOf(tx, input.companyId);
  const [owners, salesAgents] = await Promise.all([
    identitiesOf(tx, ownerUserIds),
    salesAgentIdentities(tx),
  ]);
  const [ownerAlreadyAttributed, sameDayReferralCount, sharesIdentityWithAttributedShop] = await Promise.all([
    otherAttributedCompany(tx, input.companyId, ownerUserIds),
    sameDayReferrals(tx, input),
    sharedIdentityShop(tx, input.companyId, owners),
  ]);
  return attributionFlags({
    owners, salesAgents, ownerAlreadyAttributed, sameDayReferralCount, sharesIdentityWithAttributedShop,
    source: input.source,
  });
}

async function ownerUserIdsOf(tx: Prisma.TransactionClient, companyId: string): Promise<string[]> {
  const rows = await tx.companyMembership.findMany({
    where: { companyId, status: 'ACTIVE', roles: { some: { role: { key: 'OWNER' } } } },
    select: { userId: true }, take: IDENTITY_SCAN_LIMIT,
  });
  return rows.map((row) => row.userId);
}

async function identitiesOf(tx: Prisma.TransactionClient, userIds: readonly string[]): Promise<AttributionIdentity[]> {
  if (userIds.length === 0) return [];
  const [users, identities] = await Promise.all([
    tx.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, email: true, phoneNumber: true } }),
    tx.externalIdentity.findMany({
      where: { userId: { in: [...userIds] }, provider: 'LINE', status: 'ACTIVE' },
      select: { userId: true, providerUserId: true },
    }),
  ]);
  const lineByUser = new Map<string, string[]>();
  for (const identity of identities) {
    lineByUser.set(identity.userId, [...(lineByUser.get(identity.userId) ?? []), identity.providerUserId]);
  }
  return users.map((user) => ({ email: user.email, phone: user.phoneNumber, lineUserIds: lineByUser.get(user.id) ?? [] }));
}

/**
 * Every sales account, any team — a `SalesAgentProfile` row is issued to each one at creation, so
 * the profile table IS the registry (a role lookup would answer the same set through two joins).
 * SUSPENDED agents are included on purpose: a shop owned by a suspended agent is exactly the case
 * the flag exists for.
 */
async function salesAgentIdentities(tx: Prisma.TransactionClient): Promise<AttributionIdentity[]> {
  const profiles = await tx.salesAgentProfile.findMany({ select: { userId: true } });
  return identitiesOf(tx, profiles.map((profile) => profile.userId));
}

/** §17.1 "เจ้าของคนเดียวกันเปิดหลายร้าน → นับเฉพาะร้านแรก": the second shop keeps the flag. */
async function otherAttributedCompany(
  tx: Prisma.TransactionClient, companyId: string, ownerUserIds: readonly string[],
): Promise<boolean> {
  if (ownerUserIds.length === 0) return false;
  const others = await tx.companyMembership.findMany({
    where: { userId: { in: [...ownerUserIds] }, companyId: { not: companyId }, status: 'ACTIVE',
      roles: { some: { role: { key: 'OWNER' } } } },
    select: { companyId: true }, take: IDENTITY_SCAN_LIMIT,
  });
  if (others.length === 0) return false;
  return Boolean(await tx.salesAttribution.findFirst({
    where: { companyId: { in: others.map((row) => row.companyId) } }, select: { id: true },
  }));
}

/** §17.1: "รหัสเดียวถูกใช้เกิน 20 ร้าน/วัน". Bangkok day, referral rows only, this one excluded. */
async function sameDayReferrals(tx: Prisma.TransactionClient, input: SalesAttributionInput): Promise<number> {
  if (input.source !== 'REFERRAL') return 0;
  const dayStart = new Date(`${bangkokDateKey(input.paidAt)}T00:00:00+07:00`);
  return tx.salesAttribution.count({
    where: { salesUserId: input.salesUserId, source: 'REFERRAL',
      paidAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000) } },
  });
}

/** §17.1: "ร้านแนะนำหลายร้านใช้ LINE/เบอร์ ... เดียวกัน". No signup IP is stored, so that leg is absent. */
async function sharedIdentityShop(
  tx: Prisma.TransactionClient, companyId: string, owners: readonly AttributionIdentity[],
): Promise<boolean> {
  const phones = owners.map((owner) => owner.phone).filter((phone): phone is string => Boolean(phone?.trim()));
  const lineIds = owners.flatMap((owner) => [...(owner.lineUserIds ?? [])]).filter(Boolean);
  if (phones.length === 0 && lineIds.length === 0) return false;
  const [byPhone, byLine] = await Promise.all([
    phones.length ? tx.user.findMany({ where: { phoneNumber: { in: phones } }, select: { id: true }, take: IDENTITY_SCAN_LIMIT }) : [],
    lineIds.length ? tx.externalIdentity.findMany({ where: { provider: 'LINE', providerUserId: { in: lineIds }, status: 'ACTIVE' },
      select: { userId: true }, take: IDENTITY_SCAN_LIMIT }) : [],
  ]);
  const twinUserIds = [...new Set([...byPhone.map((user) => user.id), ...byLine.map((row) => row.userId)])];
  if (twinUserIds.length === 0) return false;
  const twinCompanies = await tx.companyMembership.findMany({
    where: { userId: { in: twinUserIds }, companyId: { not: companyId }, status: 'ACTIVE',
      roles: { some: { role: { key: 'OWNER' } } } },
    select: { companyId: true }, take: IDENTITY_SCAN_LIMIT,
  });
  if (twinCompanies.length === 0) return false;
  return Boolean(await tx.salesAttribution.findFirst({
    where: { companyId: { in: twinCompanies.map((row) => row.companyId) } }, select: { id: true },
  }));
}
