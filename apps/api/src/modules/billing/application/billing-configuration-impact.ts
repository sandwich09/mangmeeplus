import type { BillingConfigurationImpact, BillingConfigurationImpactKind, BillingConfigurationImpactItem } from '@watchdog-bms/contracts';
import { Prisma } from '../../../generated/prisma/client';

type Snapshot = Omit<BillingConfigurationImpact, 'prices'> & { cursorValid: boolean; items: BillingConfigurationImpactItem[] };

/** One SQL snapshot for totals, exact material source, cursor validation and the bounded page. */
export async function configurationImpact(tx: Prisma.TransactionClient, scope: { stripeAccountId: string; livemode: boolean },
  page?: { kind: BillingConfigurationImpactKind; cursor?: string }): Promise<Snapshot> {
  const [snapshot] = await tx.$queryRaw<Snapshot[]>`
    WITH accounts AS (SELECT * FROM "BillingAccount" WHERE "stripeAccountId"=${scope.stripeAccountId} AND livemode=${scope.livemode}),
    records AS (
      SELECT 'SUBSCRIPTION:'||b.id AS reference, 'SUBSCRIPTION'::text AS kind, b.id AS "recordId", b."companyId", b."subscriptionState" AS state,
        b."paidThrough" AS boundary, b."nextChargeAt", jsonb_build_array(b.id,b."companyId",b."baseSubscriptionId",b."subscriptionState",b."paidThrough",b."nextChargeAt",
          b."cancelAtPeriodEnd",b."contractAttemptId",b."pendingPlanChangeId") AS source
        FROM accounts b WHERE b."baseSubscriptionId" IS NOT NULL AND b."subscriptionState"<>'canceled'
      UNION ALL SELECT 'ATTEMPT:'||a.id,'ATTEMPT',a.id,b."companyId",a.status,NULL::timestamp,NULL::timestamp,
        jsonb_build_array(a.id,b.id,b."companyId",a.status,a.version,a."requestHash") FROM "BillingAttempt" a JOIN accounts b ON b.id=a."billingAccountId"
        WHERE a.status IN ('CREATING','REQUESTING','OPEN','UNKNOWN','PAID','APPLYING')
      UNION ALL SELECT 'QUOTE:'||q.id,'QUOTE',q.id,q."companyId",'UNUSED',q."expiresAt",NULL::timestamp,jsonb_build_array(q.id,q."companyId",q."policyRevisionId",q."expiresAt")
        FROM "BillingQuote" q JOIN "BillingPolicyRevision" r ON r.id=q."policyRevisionId"
        WHERE r."stripeAccountId"=${scope.stripeAccountId} AND r.livemode=${scope.livemode} AND q."expiresAt">NOW()
          AND NOT EXISTS (SELECT 1 FROM "BillingAttempt" a WHERE a."quoteId"=q.id)
      UNION ALL SELECT 'PLAN_CHANGE:'||b."pendingPlanChangeId",'PLAN_CHANGE',b."pendingPlanChangeId",b."companyId",COALESCE(o.state,'MISSING'),b."paidThrough",b."nextChargeAt",
        jsonb_build_array(b.id,b."companyId",b."pendingPlanChangeId",b."paidThrough",o.state,o.version,o."requestHash") FROM accounts b
        LEFT JOIN "BillingOperation" o ON o.id=b."pendingPlanChangeId" AND o."companyId"=b."companyId" AND o."stripeAccountId"=${scope.stripeAccountId} AND o.livemode=${scope.livemode}
        WHERE b."pendingPlanChangeId" IS NOT NULL
      UNION ALL SELECT 'COLLECTION:'||b."activeCollectionOperationId",'COLLECTION',b."activeCollectionOperationId",b."companyId",COALESCE(o.state,'MISSING'),b."paidThrough",b."nextChargeAt",
        jsonb_build_array(b.id,b."companyId",b."activeCollectionOperationId",b."paidThrough",o.state,o.version,o."requestHash") FROM accounts b
        LEFT JOIN "BillingOperation" o ON o.id=b."activeCollectionOperationId" AND o."companyId"=b."companyId" AND o."stripeAccountId"=${scope.stripeAccountId} AND o.livemode=${scope.livemode}
        WHERE b."activeCollectionOperationId" IS NOT NULL
    )
    SELECT count(*) FILTER (WHERE kind='SUBSCRIPTION')::int AS subscriptions,
      count(*) FILTER (WHERE kind='ATTEMPT')::int AS "inFlightAttempts",count(*) FILTER (WHERE kind='QUOTE')::int AS "unusedQuotes",
      count(*) FILTER (WHERE kind='PLAN_CHANGE')::int AS "pendingPlanChanges",count(*) FILTER (WHERE kind='COLLECTION')::int AS "collectionCommands",
      encode(sha256(convert_to(COALESCE(string_agg(jsonb_build_array(kind,source,"nextChargeAt")::text,',' ORDER BY reference COLLATE "C"),''),'UTF8')),'hex') AS "sourceHash",
      (${page?.cursor ?? null}::text IS NULL OR EXISTS(SELECT 1 FROM records r WHERE r.kind=${page?.kind ?? null} AND r.reference=${page?.cursor ?? null})) AS "cursorValid",
      (SELECT COALESCE(jsonb_agg(item ORDER BY item.reference COLLATE "C"),'[]'::jsonb) FROM (
        SELECT reference,kind,"recordId","companyId",state,to_char(boundary,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS boundary,
          to_char("nextChargeAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "nextChargeAt" FROM records r WHERE r.kind=${page?.kind ?? null}
          AND (${page?.cursor ?? null}::text IS NULL OR r.reference COLLATE "C">${page?.cursor ?? null}::text COLLATE "C") ORDER BY reference COLLATE "C" LIMIT 26
      ) item) AS items FROM records`;
  return snapshot!;
}
