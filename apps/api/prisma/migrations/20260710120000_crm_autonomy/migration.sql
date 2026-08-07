-- B7+B10 P2 CRM autonomy schema foundation. Additive only; DB application is owner-coordinated.
ALTER TYPE "CrmMessageAuthorType" ADD VALUE IF NOT EXISTS 'AI';

CREATE TYPE "CrmBookingSource" AS ENUM ('STAFF', 'LINE');

ALTER TABLE "CompanyMessagingChannel" ADD COLUMN "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanyMessagingChannel" ADD COLUMN "autoReplyDailyCap" INTEGER NOT NULL DEFAULT 50;

ALTER TABLE "CrmConversation" ADD COLUMN "autoReplyCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CrmConversation" ADD COLUMN "autoReplyCheckedAt" TIMESTAMP(3);

ALTER TABLE "CrmBooking" ADD COLUMN "source" "CrmBookingSource" NOT NULL DEFAULT 'STAFF';
