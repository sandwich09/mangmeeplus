import { NotFoundException } from '@nestjs/common';
import type { BillingTimeline } from '@watchdog-bms/contracts';
import { Prisma } from '../../../generated/prisma/client';

type Entry = { reference: string; kind: string; type: string; state: string; recordedAt: Date; occurredAt: Date | null;
  updatedAt: Date | null; observedAt: Date | null; origin: string | null; amountSatang: number | null };

/** Caller has already checked current operator/company scope; every source also binds account/mode. */
export async function billingTimeline(tx: Prisma.TransactionClient, scope: { companyId: string; accountId: string | null;
  stripeAccountId: string | null; livemode: boolean; financial: boolean; audit: boolean; cursor?: string }): Promise<BillingTimeline> {
  const sources = Prisma.sql`WITH accounts AS (
    SELECT * FROM "BillingAccount" WHERE id=${scope.accountId} AND "companyId"=${scope.companyId}
      AND "stripeAccountId"=${scope.stripeAccountId} AND livemode=${scope.livemode}
  ), attempts AS (SELECT a.* FROM "BillingAttempt" a JOIN accounts b ON a."billingAccountId"=b.id),
  invoices AS (SELECT i.* FROM "BillingInvoice" i JOIN accounts b ON i."billingAccountId"=b.id),
  operations AS (SELECT * FROM "BillingOperation" WHERE type<>'OBSERVE_PROVIDER_INVOICE' AND "companyId"=${scope.companyId} AND "stripeAccountId"=${scope.stripeAccountId} AND livemode=${scope.livemode}),
  issues AS (SELECT * FROM "BillingIssue" WHERE "companyId"=${scope.companyId} AND "stripeAccountId"=${scope.stripeAccountId} AND livemode=${scope.livemode}),
  events AS (
    SELECT 'PLAN_TERM:'||id AS reference,'PLAN_TERM'::text AS kind,'CURRENT_PLAN_TERM'::text AS type,"tierKey" AS state,"createdAt" AS "recordedAt",
      NULL::timestamp AS "occurredAt","updatedAt",NULL::timestamp AS "observedAt",'ERP'::text AS origin,NULL::integer AS "amountSatang" FROM "CompanyPlanTerm" WHERE "companyId"=${scope.companyId}
    UNION ALL SELECT 'ATTEMPT:'||id,'ATTEMPT','PURCHASE',status,"createdAt","consentAt","updatedAt",NULL,channel,NULL FROM attempts
    UNION ALL SELECT 'INVOICE:'||id,'INVOICE','BILLING_INVOICE',"providerStatus"||' / '||"applyStatus","createdAt",NULL,"updatedAt","financialObservedAt",NULL,
      CASE WHEN ${scope.financial} THEN "totalSatang" ELSE NULL END FROM invoices
    UNION ALL SELECT 'OPERATION:'||id,'OPERATION',type,state,"createdAt",NULL,"updatedAt","observedAt",NULL,NULL FROM operations
    UNION ALL SELECT 'ISSUE:'||id,'ISSUE',kind,state,"createdAt",NULL,"updatedAt","resolvedAt",NULL,NULL FROM issues
    UNION ALL SELECT 'DELIVERY:'||d.id,'DELIVERY',d.channel::text,d.status::text,d."createdAt",d."sentAt",d."updatedAt",NULL,NULL,NULL
      FROM "NotificationDelivery" d JOIN "NotificationRecipient" r ON r.id=d."recipientId" AND r."companyId"=d."companyId"
      JOIN "NotificationEvent" e ON e.id=r."eventId" AND e."companyId"=d."companyId"
      JOIN invoices i ON e."sourceModule"='billing' AND e."sourceType"='invoice' AND e."sourceId"=i.id WHERE d."companyId"=${scope.companyId}
    UNION ALL SELECT 'PROVIDER_EVENT:'||e.id,'PROVIDER_EVENT',e."eventType",e.status,e."receivedAt",NULL,NULL,e."processedAt",NULL,NULL
      FROM "BillingProviderEvent" e WHERE e."stripeAccountId"=${scope.stripeAccountId} AND e.livemode=${scope.livemode} AND (
        EXISTS(SELECT 1 FROM invoices i WHERE i."providerInvoiceId"=e."objectId" OR i."providerChargeId"=e."objectId") OR
        EXISTS(SELECT 1 FROM attempts a WHERE a."checkoutSessionId"=e."objectId" OR a."subscriptionId"=e."objectId") OR
        EXISTS(SELECT 1 FROM accounts b WHERE b."baseSubscriptionId"=e."objectId"))
    UNION ALL SELECT 'AUDIT:'||a.id,'AUDIT',a.action,a.result::text,a."createdAt",a."createdAt",NULL,NULL,NULL,NULL FROM "AuditLog" a
      WHERE ${scope.audit} AND a."companyId"=${scope.companyId} AND a.action LIKE 'billing.%' AND (
        (a."targetType"='BillingAccount' AND EXISTS(SELECT 1 FROM accounts b WHERE b.id=a."targetId")) OR
        (a."targetType"='BillingAttempt' AND EXISTS(SELECT 1 FROM attempts b WHERE b.id=a."targetId")) OR
        (a."targetType"='BillingInvoice' AND EXISTS(SELECT 1 FROM invoices b WHERE b.id=a."targetId")) OR
        (a."targetType"='BillingOperation' AND EXISTS(SELECT 1 FROM operations b WHERE b.id=a."targetId")) OR
        (a."targetType"='BillingIssue' AND EXISTS(SELECT 1 FROM issues b WHERE b.id=a."targetId")))
  )`;
  const cursor = scope.cursor ? (await tx.$queryRaw<Entry[]>(Prisma.sql`${sources} SELECT * FROM events WHERE reference=${scope.cursor}`))[0] : null;
  if (scope.cursor && !cursor) throw new NotFoundException();
  const rows = await tx.$queryRaw<Entry[]>(Prisma.sql`${sources} SELECT * FROM events
    ${cursor ? Prisma.sql`WHERE ("recordedAt",reference COLLATE "C") < (${cursor.recordedAt},${cursor.reference} COLLATE "C")` : Prisma.empty}
    ORDER BY "recordedAt" DESC,reference COLLATE "C" DESC LIMIT 26`);
  const outcomes=await tx.billingOperation.findMany({where:{id:{in:rows.slice(0,25).filter(row=>row.kind==='OPERATION'&&row.type==='RECORD_SUPPORT_OUTCOME').map(row=>row.reference.slice(10))},
    type:'RECORD_SUPPORT_OUTCOME',companyId:scope.companyId,stripeAccountId:scope.stripeAccountId??'',livemode:scope.livemode},select:{id:true,referenceId:true}});
  const outcomeLinks=new Map(outcomes.filter(row=>row.referenceId).map(row=>[`OPERATION:${row.id}`,`/system/billing/issues/${encodeURIComponent(row.referenceId!)}?outcome=${encodeURIComponent(row.id)}`]));
  return { items: rows.slice(0,25).map(row => ({ ...row, recordedAt:row.recordedAt.toISOString(), occurredAt:row.occurredAt?.toISOString() ?? null,
    updatedAt:row.updatedAt?.toISOString() ?? null, observedAt:row.observedAt?.toISOString() ?? null,
    href: (row.kind==='OPERATION'&&row.type==='SCAN_PROVIDER_INVOICES'?`/system/billing/companies/${encodeURIComponent(scope.companyId)}/invoice-scans/${encodeURIComponent(row.reference.slice(10))}`:outcomeLinks.get(row.reference)) ?? (row.kind==='ISSUE' ? `/system/billing/issues/${encodeURIComponent(row.reference.slice(6))}` :
      row.kind==='ATTEMPT'?`/system/billing/companies/${encodeURIComponent(scope.companyId)}/checkouts/${encodeURIComponent(row.reference.slice(8))}`:
      row.kind==='OPERATION'&&row.type==='EXPIRE_CHECKOUT'?`/system/billing/checkout-expiry/${encodeURIComponent(row.reference.slice(10))}`:
      row.kind==='OPERATION'&&['GRANT_OVERRIDE','REVOKE_OVERRIDE','GRANT_FREE_DAYS','CHANGE_COLLECTION'].includes(row.type)&&scope.financial?`/system/billing/plan-adjustments/${encodeURIComponent(row.reference.slice(10))}`:
      row.kind==='OPERATION'&&['GRANT_RECEIPTS','REVOKE_RECEIPTS'].includes(row.type)&&scope.financial?`/system/billing/receipt-adjustments/${encodeURIComponent(row.reference.slice(10))}`:
      row.kind==='OPERATION'&&row.type==='REFUND'&&scope.financial?`/system/billing/refunds/${encodeURIComponent(row.reference.slice(10))}`:
      row.kind==='OPERATION' && ['RECONCILE','IMPORT_INVOICE','RETRY_APPLY','RETRY_NOTIFICATION','RECONCILE_NOTIFICATION'].includes(row.type) ? `/system/billing/operations/${encodeURIComponent(row.reference.slice(10))}` : null) })),
    nextCursor: rows.length>25 ? rows[24]!.reference : null, auditIncluded:scope.audit, financialIncluded:scope.financial };
}
