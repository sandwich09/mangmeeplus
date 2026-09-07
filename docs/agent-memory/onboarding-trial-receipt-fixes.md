# Agent Memory: onboarding trial receipt fixes

Status: Discovery/spec/plan prepared; read-only agent audits complete or finishing. Application implementation has not started.
Owner: Coordinator with GPT-6 Astra xhigh receipt/email lanes and GPT-5.6 Sol xhigh web lane, as requested by the same-workflow instruction.
Scope: User issues1–5: first receipt after signup, trial15 consistency, syntax-only signup contact email, failed receipt reads free of customer quota, prominent dashboard profile actions. Same authorized Git delivery through develop/main admin merges; no deployment now.
Decisions:
- Base develop ca36d69751ad37629bb512b0d0d3585afdcf010e; branch codex/onboarding-trial-receipt-fixes-20260907; dedicated sibling worktree. Original user changes preserved.
- Trial ten is actual warmup enforcement, not just copy. Use trial term monthlySlipLimit from day one, preserving explicit admin limits and separate operational caps; align default15 and existing trial rows without speculative data mutation.
- Failure accounting must distinguish provider/parse/apply failure from governance decisions and notification failure. Reuse the event ledger and exact-attempt compensation; preserve provider spend.
- Email is unverified shop contact in CompanySignupRequest.contactEmail and Company.email, not User.email or identity proof. Required is the current interpretation; optional clarification asked and a later user answer supersedes it.
- No new flags. Carry the owner's requirement to enable LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED and LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED at the next UAT/Production deployment.
Open questions:
- Optional required-versus-optional email clarification pending; proceeding with required as stated to the owner, based on the requested added signup field.
Artifacts:
- docs/specs/onboarding-trial-receipt-fixes-spec.md
- docs/plans/onboarding-trial-receipt-fixes-plan.md
Verification:
- Read AGENTS and repository ponytail full; legacy absolute skill path is stale, same repository skill used as prior round.
- git fetch/pull --ff-only succeeded; isolated branch created at ca36d697.
- Read-only audits located warmup10 in shared contracts/config/provisioning/effective quota; missing compensation for OCR_EMPTY_OUTPUT/OCR_JSON_PARSE_FAILED/malformed JSON and downstream failed apply; safe existing contact-email storage; dashboard has only a small snooze link.
- Offline frozen-lockfile dependency setup started; generated Prisma client/build prerequisites are coordinator-owned.
Next: Commit docs-first baseline, authorize scoped lane implementation, integrate/test and deliver both PRs. Keep actual runtime deployment separate and preserve the two required next-release flags.
