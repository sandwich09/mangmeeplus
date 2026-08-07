-- Incomplete employee-provisioning runs must not receive active company access.
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'ACTIVE';
