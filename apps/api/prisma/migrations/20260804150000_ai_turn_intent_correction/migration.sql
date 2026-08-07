-- LINE AI post-capture correction: correction turns persist with their own intent so
-- conversation context stays truthful and metrics separate corrections from captures.
-- Additive enum value only; no table or data changes.
ALTER TYPE "AiTurnIntent" ADD VALUE IF NOT EXISTS 'CORRECTION';
