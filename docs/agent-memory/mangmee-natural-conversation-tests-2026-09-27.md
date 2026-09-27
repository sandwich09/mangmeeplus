# Agent Memory: Natural SME conversation review

Status: documentation complete and verified; authorized main/develop integration follows. No real-provider run.
Owner: root; review-packet author and independent corpus audit.
Scope: user-requested ordinary Thai/SME language, typos, incomplete messages, reference and progressive multi-turn questions. No internal document ID required in the main journey.
Decisions:
- Reuse clean managed worktree, branch `codex/mangmee-natural-conversation-tests-20260927` from main `dac28b73`.
- Preserve original dirty workspace, historical225case artifact, existing knowledge/asset source hashes and all approvals as unreviewed.
- Update the human review entry with12NAT dialogues and per-turn expected behavior. These are authored synthetic development scenarios, not empirical frequent customer questions, executable/passing fixtures or human-reviewed examples.
- Keep technical regressions and machine numeric/effect oracles separate; promote new questions into existing harness only with explicit source/identity/checkpoint binding. No new evaluation framework, dependency, package.json or production changes.
- Public lookup, voice and Financial Profile/Services Needs remain deferred. Legitimate in-scope requests must not be marked unsupported merely because current implementation fails.
Open questions: Human intent/content review and source fixture binding remain pending; no implementation boundary is guessed.
Artifacts: Parent spec owner update, W14 plan, acceptance catalog§1.1, human review packet C/NAT-01–NAT-12.
Verification:
- Exactly12NAT dialogues/60user messages; zero user messages require internal document IDs. All remain UNREVIEWED/DESIGN ONLY/NOT RUN.
- Human packet sectionsA/B and full hash/provenance appendix are byte-identical to the previous committed version. Corpus generator/artifact, source cards and synthetic assets unchanged.
-94relative Markdown links across changed spec/plan/catalog/packet resolve.
- `pnpm exec tsx --test scripts/line-ai-reliability-corpus.spec.ts`:8passed,0failed,0skipped; `/tmp/mangmee-natural-corpus-preservation.log`. This verifies old artifact integrity, not new dialogue comprehension.
- Independent review of12dialogues and related policy found no blocking documentation issue. Root made the NAT04 transition to requesting a draft explicit and removed an unnecessary pending-task assumption from NAT09.
- `git diff --check`:pass. No product code, dependency/package or deployment change.
Next: Integrate main/develop under standing authorization (GitHub receipts in task handoff), then human intent/content review and source-backed fixture binding before scoped provider evaluation. No quality score is claimed for these new questions.
