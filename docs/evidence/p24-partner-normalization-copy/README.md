# P24 — Partner normalization-pending guidance

Captured 2026-08-27 against local web `http://127.0.0.1:3000` and API
`http://127.0.0.1:3001/v1`. Source: branch
`codex/p24-partner-normalization-copy`, based on develop `d2b40f37`.

## Real Chrome acceptance

1. Sign in through the local login form with the repository SYSTEM_ADMIN seed fixture.
2. Open Partners → WatchDog Local Company → แพ็กเกจการใช้งาน.
3. Inspect the current normalization-pending state without changing company features.
4. Repeat at desktop 1280×900 and mobile 390×844; inspect saved screenshots.

- [Desktop locked guidance](desktop-locked-guidance.jpg)
- [Mobile locked guidance](mobile-locked-guidance.jpg)

Both sizes show “ขณะนี้ยังเปิดหรือปิดฟีเจอร์ไม่ได้” and the existing canonical
normalization banner. The old promise that enabling remains available and the old
reload advice are absent. Existing checked switches remain disabled. No horizontal
page overflow was measured; browser warning/error log was empty.

No entitlement save, normalization command, database edit, cloud operation or
financial mutation was performed. This evidence verifies the copy matches the
existing locked state; it does not prove normalization execution, unlocked feature
mutations, physical-device accessibility, or complete P24 acceptance.

## Runnable checks

- `pnpm --filter @watchdog-bms/web test` — 1128 passed, zero failed/skipped.
- `pnpm --filter @watchdog-bms/web typecheck` — passed.
- `git diff --check` — passed before commit.

Scoped decisions and original focused checks:
[agent memory](../../agent-memory/p24-partner-normalization-copy.md).
