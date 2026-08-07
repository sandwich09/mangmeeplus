-- Item 10B multi-turn memory: intake-routed turns (evidence capture, signature request,
-- clarify) are persisted so follow-up questions can reference them. Additive enum values only.
ALTER TYPE "AiTurnIntent" ADD VALUE IF NOT EXISTS 'EVIDENCE_CAPTURE';
ALTER TYPE "AiTurnIntent" ADD VALUE IF NOT EXISTS 'SIGNATURE_REQUEST';
ALTER TYPE "AiTurnIntent" ADD VALUE IF NOT EXISTS 'CLARIFY';
