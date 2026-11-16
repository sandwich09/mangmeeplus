# Shared brief for the close-out software documentation set

## Why this exists
The MangmeePlus / WatchDog-BMS project was closed on 2026-11-16. All cloud infrastructure is deleted and
the source folder on the owner's Mac will be deleted after this documentation is written. This document set
is the permanent engineering record. A future team must be able to understand, rebuild and operate the
product from these documents plus the archived code. Completeness and accuracy against the real code matter
more than brevity.

## Source of truth
- Checkout: `/Users/thawatchai/Project/MangmeeYungYuen/mangmee-worktrees/closeout-docs-main`
  (clean `origin/main`, commit `08850deaf`, 2026-11-10). Read ONLY this checkout.
- **Code is the truth.** `docs/` (specs, plans, ADRs, runbooks, agent-memory) is supporting material: use it for
  intent, rationale and history, but verify every stated behaviour against code. If a spec describes something
  the code does not implement, say so explicitly ("มีใน spec แต่ไม่พบในโค้ด"). Never invent behaviour.
- Monorepo layout: `apps/api` (NestJS + Prisma, ERP core), `apps/web` (Next.js), `apps/ai-gateway`
  (LINE AI / agents, separate from ERP core, calls permission-checked APIs), `apps/workers`, `packages/contracts`
  (shared types, package catalog, entitlements, permissions), `packages/config`, `packages/design-tokens`,
  `e2e/` (Playwright), `infra/`, `scripts/`.

## Scope: everything sold up to the 1,999 THB pack
- Packages (see `packages/contracts/src/plan-term.ts`, `billing.ts`, `menu-entitlements.ts`,
  `feature-entitlements.ts`): FREE_TRIAL_15, STARTER_249, BASIC_499, PRO_999, ENTERPRISE_1999.
  ENTERPRISE_1999 is the top pack, so the scope is **every feature entitled in any tier up to and including
  ENTERPRISE_1999**, plus the add-ons (chat credit, receipt image), plus the platform/system-admin, billing,
  sales and LINE/AI surfaces that exist to sell and operate those packs.
- For every feature state which tiers include it (derive from `TIER_FEATURE_PRESETS` / the feature catalog;
  do not guess).
- A module or menu that exists in code but is not entitled to any tier (status `planned`, hidden, or not in any
  preset) is OUT of scope: list it in a short final section "นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)" with
  one line each, and do not document it in depth.

## Writing rules
- Language: Thai prose. Keep identifiers, file paths, API routes, model names, permission keys, enum values
  and technical terms in English exactly as in code.
- Cover every feature and function in your area; do not sample. Where a list is long (endpoints, models,
  screens, permissions) give the complete list in tables.
- Cite evidence as repo-relative paths (`apps/api/src/modules/...`), with line numbers where it helps.
- Requirement IDs: `FR-<AREA>-<nnn>` for functional, `NFR-<nnn>` for non-functional. Use the AREA code given
  in your task so the traceability matrix can join documents.
- For each functional requirement give: ชื่อ, คำอธิบาย, ผู้ใช้/บทบาทและ permission keys, แพ็กที่ได้ใช้,
  เงื่อนไขก่อนทำ, ขั้นตอนหลัก, กฎธุรกิจและข้อยกเว้น, การตรวจสอบข้อมูล/ข้อผิดพลาด, ข้อมูลที่เกี่ยวข้อง (Prisma models),
  API endpoints, หน้าจอ (web routes), การทดสอบที่ครอบคลุม (spec/e2e files).
- Never print secret values, tokens, passwords, customer personal data, or real account numbers.
- Start the file with a title, a one-paragraph purpose, the commit it was derived from, and a table of contents.

## Working rules
- Read-only investigation. The ONLY file you may create or edit is your assigned output file under
  `docs/software-documentation/`. Write it in several passes (Write, then Edit to append) rather than one
  giant call, so partial work is never lost.
- Do not run installs, builds, tests, dev servers, docker, or any network call. Do not run git commands that
  change state. Never use pkill/killall. grep/find/cat/wc and `git ls-files`/`git grep`/`git log` are fine.
- Do not spawn further agents.
- Final reply to the controller: the output path, line count, the list of FR/NFR IDs you defined with a
  one-line name each (compact), anything you could not verify, and anything found in docs but not in code.
