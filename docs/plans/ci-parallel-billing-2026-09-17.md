# Parallel billing CI

Status: local verification passed; remote parallel CI and merges pending final-head success.

Goal: reduce elapsed pull-request CI time without removing checks or changing production behavior. Baseline run35167881639 took53 minutes: billing HTTP20m12s, subsequent browser/configuration journeys19m04s, with core tests and setup around14 minutes.

Change: keep the existing Typecheck and Test job and its recovery evidence names. Move billing integration into three concurrent matrix jobs (backend, customer, operations), each with its own runner, PostgreSQL and Redis. Preserve every existing test command, provider simulation, timeout and assertion. Build the API independently in each shard; install Chromium before browser tests. Do not introduce caches of database state or share mutable fixtures between jobs.

Release boundary: both image and release-tool publishers must require all billing shards to succeed as well as the existing gates. Exact successful PR CI reuse and controller/recovery-only exceptions remain explicit; a failed or cancelled shard must never authorize publishing or merging. No UAT/Production dispatch in this task.

Verification: compare commands before/after the move, validate workflow syntax and release contracts, reproduce/fix the existing action-loading failure without weakening its assertion, then run both PRs on the final commit and record actual elapsed time. Expected25–30 minutes is an estimate until measured.

Related CI failure: runs35195352419/35195352524 failed because two new BillingCollectionPanel back controls lacked aria-busy; add the existing busy attribute and rerun the original accessibility suite.

Local verification: original action-loading suite11/11 passed (`/tmp/mangmee-action-loading-fix.log`). YAML parse and Bash syntax passed; compared all11 original integration steps and30 commands against the preceding commit, preserving each environment and timeout. Publishing dependencies require billing matrix success. Full existing production-image-security suite passed (`/tmp/mangmee-ci-parallel-release-contracts.log`), including the updated matrix/publishing assertions; maintenance pins and diff check passed. No dependency or package.json changes.
