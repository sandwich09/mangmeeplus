-- CUST-02 (F3): record when a proposal's confirm question was actually delivered so
-- the resolution gate can commit only the slot the customer most-recently saw asked
-- — a stale question sent last must never confirm the wrong slot. Additive, nullable.
ALTER TABLE "CrmBookingProposal" ADD COLUMN "questionSentAt" TIMESTAMP(3);
