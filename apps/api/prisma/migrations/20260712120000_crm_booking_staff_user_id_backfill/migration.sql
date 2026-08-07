-- CrmBooking.staffUserId is canonically a User id (CompanyMembership.userId) — the
-- space used by booking reminder recipients, membership default-branch lookups, and
-- conversation assignment. The bookings staff picker used to send
-- EmployeeAccessProfile ids instead; rewrite any stored profile ids to the profile's
-- userId. The company-scoped join guards against cross-tenant id collisions, and the
-- rewrite is idempotent (a rewritten value no longer matches any profile id).
UPDATE "CrmBooking" AS b
SET "staffUserId" = e."userId"
FROM "EmployeeAccessProfile" AS e
WHERE b."staffUserId" = e."id"
  AND b."companyId" = e."companyId";

-- Same defensive rewrite for the LINE channel booking default, in case a row was saved
-- while an earlier settings UI sent profile ids.
UPDATE "CompanyMessagingChannel" AS c
SET "defaultBookingStaffUserId" = e."userId"
FROM "EmployeeAccessProfile" AS e
WHERE c."defaultBookingStaffUserId" = e."id"
  AND c."companyId" = e."companyId";
