-- Operator reconciliation of held AI credit (hold-reconciliation spec §4.2, ADR 0013 §11 H3).
--
-- Additive and widening only: two nullable columns, and one CHECK replaced by a strictly larger
-- one. No backfill, no rewrite, no re-pricing. An OLD binary keeps working — it never selects or
-- writes the two columns, and it never emits the new usage basis.

-- Acknowledgement of a breach (`actual settled above the reserved bound`). Until now the schema
-- comment said admission stays closed "until an operator clears it" and there was nothing to clear:
-- `breach` is kept as the historical fact and these two record the operator's decision beside it, so
-- `readAiBudgetMonthSnapshot.breach` can count the UNACKNOWLEDGED rows only.
--
-- `breachAcknowledgedByUserId` is a plain id with no foreign key, like `ownerToken` beside it: the
-- authority on who did this is the `AuditLog` row written in the same transaction, and a cascade
-- from `User` must never be able to delete or rewrite money history.
ALTER TABLE "AiBudgetReservation"
  ADD COLUMN "breachAcknowledgedAt"       TIMESTAMP(3),
  ADD COLUMN "breachAcknowledgedByUserId" TEXT;

-- `OPERATOR_CHARGED_AT_BOUND`: a hold closed at its own declared upper bound by a System Admin,
-- with zero tokens and no provider call. Only the API writes it (the gateway's wire guard still
-- accepts the two provider values only), and the D1 breakdown carries it as its own basis while
-- `eventKind = 'COST_ADJUSTMENT'` keeps it out of the model-call count.
ALTER TABLE "AiUsageEvent" DROP CONSTRAINT "AiUsageEvent_usageBasis_check";
ALTER TABLE "AiUsageEvent"
  ADD CONSTRAINT "AiUsageEvent_usageBasis_check"
  CHECK ("usageBasis" IN ('PROVIDER_REPORTED', 'CONSERVATIVE_ESTIMATE', 'OPERATOR_CHARGED_AT_BOUND'));
