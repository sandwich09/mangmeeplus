-- F13: a photo answered as "ลายเซ็นของฉัน" became a signature asset but its pending row was closed
-- as RESOLVED_RECEIPT, so the intake ledger reports signatures as receipts and nobody auditing the
-- media funnel can tell the two apart. Additive enum value; every existing row keeps its meaning.
--
-- Same shape as 20260816200000_line_multi_entry_media_review, which added RESOLVED_MULTI_ENTRY_REVIEW:
-- `IF NOT EXISTS` makes it re-runnable, and Prisma runs each migration file as its own statement
-- batch outside an explicit transaction, which is what ALTER TYPE ... ADD VALUE requires on the
-- PostgreSQL versions this project targets.
ALTER TYPE "LineIntakePendingMediaStatus" ADD VALUE IF NOT EXISTS 'RESOLVED_SIGNATURE';
