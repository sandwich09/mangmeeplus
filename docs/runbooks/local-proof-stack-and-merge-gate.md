# Runbook: the local proof stack, journey tests and the merge gate

Date: 2026-10-13 · Owner's order the same day: browser tests that walk the main journeys after every merge, a proof stack that can be wiped clean and is not the shop he tries things in, and a faster working loop.

## Why this exists

During the sold-screens UX programme every unit suite and four screen reviews were green while pressing the real screens still found 13 defects; the worst sat between two pages that each looked right (a certificate issued, then an expense that could neither be confirmed nor named). One shared trial database was used by every agent for two days until that month's tax forms could no longer be downloaded there. A 60-item batch made the owner wait two days before he could try anything.

## Three stacks, three jobs

| Stack | Ports | Database | Who uses it | Rule |
|---|---|---|---|---|
| Owner's trial | web 3140, API 3141 | `watchdog_pvtry` | the owner; the controller for a last look | receives only merged, gated work; agents and lanes never walk or write it |
| Proof | web 3150, API 3151 | `watchdog_pv_proof` | journey tests, review agents, the controller's own presses | wiped and seeded before every gate run (20 seconds) |
| Real-database specs | none | `watchdog_pv_land` | the registered `*.pg.spec.ts` and repository specs | migrated by the gate |

All three run the same code: the served worktree.

## Journey tests

`e2e/journeys/<name>.journey.spec.ts`, one journey per file, every title tagged `@journey`, on the existing harness (`e2e/harness/`: `pageAs(role)`, `authedPage`, `api`).

A journey differs from the other browser specs in four ways:

1. It moves as a person moves: after the first page of each person's part, every page is reached by pressing what that person would press.
2. It asserts what the person reads at each landing (step line, notice, summary, badge, which button is on and which is off).
3. Where a button is off, its reason must be on the screen; where the journey needs the way out, it takes it.
4. It ends by reading the record from the server.

The journeys: a purchase with no receipt through certificate and confirmation; withheld payments through both tax forms; a claim declined and cancelled, then one paid; a payment document between two people; a receipt from a staff member's phone; evidence files and shop settings.

**A defect found by pressing gets a journey assertion, not only a unit test.** A new journey of a sold feature gets its file before the feature is called done.

Run them anywhere the standard local topology exists with `e2e/run-local.sh --grep @journey`. They assume a freshly seeded database (the withholding journey files a month, which locks it).

## The merge gate

After every merge into the served branch, one command runs, in this order, and writes one summary:

1. migrate the trial and real-database databases, regenerate the client, rebuild and restart the trial API;
2. the whole suites (contracts, web, API, harness, LINE whole-chain, AI gateway, both type checks, the pin checks);
3. the real-database specs;
4. the proof stack: build its API, wipe and seed its database, start it, run every journey.

Nothing is "on the trial web" for the owner until that summary is green and the controller has pressed the journey the change belongs to.

## Re-pinning in one command

A wording or guarded-file change breaks three mechanical pins: the maintenance release pins, the guide fingerprints of the LINE help pack, the LINE capability manifest. One script rewrites all three and runs the specs that hold them. It does not review: the person running it reads the diff of each file it names (a guide whose fingerprint moved: are its help cards still true?) before staging.

## Working rules that go with it

- **Cut work by journey, not by screen.** A batch is one journey, complete: rule, screens, guide text, journey test, pressed. The owner can try it while the next one is built.
- **Questions to the owner in small groups tied to a journey**, each with a recommendation; never sixty at once.
- **Lanes build, the gate judges, the controller presses the journey once.** Review agents look at screens on the proof stack only.
- **One session per batch.** The hand-over is the controller's state file plus this runbook and the task memory under `docs/agent-memory/`.
- A lane's "left because the server refuses" is a finding: press that case first.

## Where the scripts are

The portable toolkit is in `scripts/local-proof/`. Every command finds the repository from its own location and reads the ignored `settings.local.sh`; start with `settings.example.sh`. Install the repository's usual local tools and start PostgreSQL, Redis and object storage separately. The example uses the ports above, native PostgreSQL on 5432 and the local credentials from `playwright.config.ts`; set `POSTGRES_CONTAINER` only when the proof database is in that local container.

Five-line quick start, from the repository root:

```bash
cp scripts/local-proof/settings.example.sh scripts/local-proof/settings.local.sh
${EDITOR:-vi} scripts/local-proof/settings.local.sh # TRIAL_REDIS_URL=redis://localhost:6379/0; PROOF_REDIS_URL=redis://localhost:6379/3
bash scripts/local-proof/gate.sh first-proof
cat .local-proof/results/first-proof.gate
cat .local-proof/results/first-proof{.after,.summary,.realpg,-journeys.summary}
```

The last two lines use the example output folder; use your configured folder if changed. `GATE GREEN` and a zero exit status mean every stage passed; `GATE RED (<stage>)` stops at the first failing stage. Run `bash scripts/local-proof/repin.sh` only after intentional wording/guarded-file changes, and review its diff.

Commands: `proof-reset.sh`, `proof-start.sh`, `proof-stop.sh [api|web|all]`, `proof-journeys.sh <tag> [Playwright args]`, `trial-after-merge.sh <tag>`, `trial-start.sh`, `verify.sh <tag>`, `realpg.sh <tag> [extra spec paths]`, `gate.sh <tag>`, `repin.sh`, `heavy.sh <command...>`, and `tsc.sh [api|web|both]`. All are beneath `scripts/local-proof/`; `common.sh`, `stack.sh` and `result.sh` are internal helpers. Output goes beneath `LOCAL_PROOF_OUTPUT_DIR` (default `.local-proof/`), with separate `logs/`, `results/` and `pids/` directories. The gate's journey summary is `<tag>-journeys.summary`, separate from the whole-suite `<tag>.summary`.

PostgreSQL and Redis URLs must use `localhost`, `127.0.0.1` or `[::1]`; reset additionally requires the exact configured proof database name and Redis URL. Set `TRIAL_REDIS_URL` and `PROOF_REDIS_URL` to separate databases (the example uses 0 and 3); proof reset flushes only the proof Redis database. Servers have their own recorded process groups; stopping never kills by name or adopts an unrelated listener. If a port belongs to a stack started outside the toolkit, the command refuses with the port and PID: stop that stack yourself before retrying. Heavy jobs share a machine-wide lock, and the type checker keeps its separate lock too. A crashed owner's stale lock needs human inspection before removal. Both starts require a successful API `/v1/health` response within 180 seconds and print the API log tail on failure. Journeys first warm the sign-in page and protected journey pages through the harness’s local owner session. The gate reports GREEN or RED and test counts per stage (`tests=n/a` for non-test stages), plus the first failing names on RED; its exit status follows its final line. Re-pinning writes files but does not review, stage or commit them.
