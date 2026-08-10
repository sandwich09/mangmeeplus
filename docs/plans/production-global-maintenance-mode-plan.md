# Production Global Maintenance Mode Plan

Status: In progress — customer-access switch revision authorized on 2026-08-10

1. Add a singleton production customer-access state with production fail-closed defaults and an
   audited `SYSTEM_ADMIN` control API using `system.launch_gate.manage`.
2. Enforce the state in password login and the global API auth guard. Exempt `SYSTEM_ADMIN` from
   customer Terms/Privacy clickwrap without creating acceptance evidence.
3. Keep the normal login shell and add a public maintenance notice plus a system-console switch.
   Permit opening only when the canonical production serving mode is `live`.
4. Narrow the outer proxy maintenance gate to forward the login/system-control path while it still
   blocks LINE, uploads, callbacks, business APIs, AI, and queues before processing.
5. Update immutable-byte, runtime, workflow, and evidence checks; run focused API/web/proxy tests,
   Prisma generation, typechecks, YAML parsing, and local probes.
6. Create source A (all-target gate bootstrap) and source B (distinct final image), push through
   protected main and exact all-target UAT runs.
7. Close all production services with A, prove ordinary login, custom/raw API and raw AI paths are
   closed while the onboarding administrator path works and worker
   queues disabled, wait out the 900-second direct-storage URL lifetime, then run the normal
   all-target B promotion and retain maintenance after success.
8. Record exact run IDs, digests, probe evidence, unresolved blockers, and the separate conditions
   required to open the product. Opening uses a distinct UAT source C with B as the closed bridge;
   after C is verified live, `SYSTEM_ADMIN` changes the switch to `OPEN`.
