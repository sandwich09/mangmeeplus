-- Failed model calls retain our cost evidence but never customer spend (owner 2026-10-15).
-- Reuse the existing column and invocation unique index; no historical repricing.
ALTER TABLE "AiUsageEvent" DROP CONSTRAINT "AiUsageEvent_usageBasis_check";
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_usageBasis_check"
  CHECK ("usageBasis" IN ('PROVIDER_REPORTED', 'CONSERVATIVE_ESTIMATE', 'OPERATOR_CHARGED_AT_BOUND', 'COMPANY_ABSORBED'));
