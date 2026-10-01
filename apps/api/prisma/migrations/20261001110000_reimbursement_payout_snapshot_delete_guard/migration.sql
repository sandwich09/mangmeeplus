-- Reimbursement payout: a frozen account snapshot is history (payout spec §9.2, §19).
--
-- The guard of 20261001100000 lets nothing but the attestation columns of a frozen row change. A
-- frozen row could still be DELETED on its own, which loses what an approver attested and what a
-- payment was made to. This refuses that delete while the claim it belongs to still exists.
--
-- The cascade is untouched on purpose: a snapshot goes together with its claim (a deleted draft, a
-- deleted company). The cascade deletes the child rows after the claim row is gone, so the claim is
-- no longer found here and the delete goes through. Additive: one function, one trigger, no data.

CREATE FUNCTION "reimbursement_payout_destination_frozen_delete_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."frozenAt" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "ReimbursementRequest"
     WHERE "companyId" = OLD."companyId" AND "id" = OLD."reimbursementRequestId"
  ) THEN
    RAISE EXCEPTION 'reimbursement_payout_destination_frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReimbursementPayoutDestination_frozen_delete_guard"
  BEFORE DELETE ON "ReimbursementPayoutDestination"
  FOR EACH ROW EXECUTE FUNCTION "reimbursement_payout_destination_frozen_delete_guard"();
