# LINE signup recovery and support — acceptance

Application source `46a5b791342c14c056e7853748c3c93ca384d592`.

- [Develop PR477](https://github.com/MangmeeDev/mangmeeplus/pull/477), [CI34138514480](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34138514480) PASS, merge `9014e14ad330cdb178fa356173da63f394b9aae3`.
- [Main PR478](https://github.com/MangmeeDev/mangmeeplus/pull/478), [CI34138526460](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34138526460) PASS, merge `1c732df1692b118de235794b1f81536b85c31e2c`.
- Both remote trees equal the tested application source. No deployment was performed by this task.

Full workspace tests/typecheck pass. PostgreSQL signup28+14, firstreceipt1, support18 pass. Local browser9+2 pass with actual admin API/DB persistence and permissions; LINE identity/public signup and outbound provider boundaries are mocked. The three lane evidence files record focused commands and counts. The baseline JSON files are pre-fix reproductions, not current failures.

Accepted screenshots are stored beside this README. Earlier screenshots showing request numbers or the superseded mobile layout were deleted. Raw local logs and disposable probe copies are not retained; successful CI links plus the committed regression tests are the durable verification record. Production-image publication and live acceptance are separate release work.

The retained Redis probe uses only a disposable local Redis on port16569 and random test-scoped keys. From repository root, run with an isolated Redis available:

```sh
pnpm --filter @watchdog-bms/api exec tsx --tsconfig tsconfig.json "$PWD/docs/qa/evidence/line-signup-recovery-2026-09-07/verify-redis-once.ts"
```

It verifies concurrent consume-once, lost response after commit, and principal isolation against the actual Lua path. It removes its own random keys and closes its client.
