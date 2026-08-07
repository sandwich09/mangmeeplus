# Codex CLI kickoff

Run from the repo root (`WatchDog-BMS`). Codex auto-reads `AGENTS.md`; point it at the harness with this prompt.

```bash
codex "You are the E2E test executor for WatchDog-BMS. \
Read e2e/HANDOFF.md and e2e/TEST-CASES.md in full before writing any code. \
The harness (auth, fixtures, runner) is already built in e2e/harness/ and e2e/run-local.sh — import from it, do not reinvent it. \
e2e/_reference.spec.ts is the pattern to copy. \
\
Task: implement the test cases in e2e/TEST-CASES.md as Playwright specs under e2e/, one spec file per suite as named in the doc. \
Work P0 first (all 28 P0 cases green), then P1, then P2. \
\
Rules (from HANDOFF.md): \
- Start by running: e2e/run-local.sh --grep @smoke  — this must be green before you write anything. If red, fix the ENVIRONMENT, not the tests. \
- DB is native postgres on :5432 (seeded); never source .env (it points at a dead docker port). The runner pins the right DATABASE_URL. \
- Default UI locale is Thai: assert with th|en regexes, navigate by URL, assert by role. \
- After each goto, call expectNoClientError(page). \
- For write flows, also verify backend truth via the api fixture. \
- Do not loosen a test to make a product bug pass — file it as BUG-n with a trace. \
- Quarantine (test.fixme) anything blocked on MinIO/Redis with a one-line reason. \
\
Run each suite as you finish it: e2e/run-local.sh e2e/<suite>.spec.ts \
Then a full run: e2e/run-local.sh \
Finally write e2e/RESULTS.md in the exact format of HANDOFF.md section 7, and list every failure classified as rig/env/product with trace paths. \
Stop when P0 and P1 are green and RESULTS.md is written."
```

Notes:
- Add `--full-auto` / your usual Codex approval flags as you prefer; the suite only touches localhost + the local DB.
- First `run-local.sh` invocation rebuilds api+web (~2 min) before the first test.
- If Codex needs to log in as a non-owner (SET/SYS/XC-03 cases), the seeded creds are in HANDOFF.md §4.
