-- CUST-02: the booking proposal must carry the service display name so an
-- autonomous booking can be committed from the persisted proposal at confirmation
-- time (createAutonomousBooking requires serviceName). Additive, nullable.
ALTER TABLE "CrmBookingProposal" ADD COLUMN "serviceName" TEXT;
