# Production Global Maintenance Mode Plan

Status: In progress

1. Add a strict, outer-proxy maintenance response and focused no-upstream tests.
2. Pass the controller-owned flag into api-web and disable worker queues; verify both from live ECS
   configuration.
3. Add a fail-closed `maintenance_only` production input that defers only launch-specific evidence,
   preserves minimum residual-processing privacy obligations, and pins the maintenance contract for
   final and bridge sources.
4. Add workflow/deploy safety specs and run focused tests, typechecks, YAML parsing, and local HTTP
   probes.
5. Create source A (all-target gate bootstrap) and source B (distinct final image), push through
   protected main and exact all-target UAT runs.
6. Close all production services with A, prove custom/raw API and raw AI paths are closed and worker
   queues disabled, wait out the 900-second direct-storage URL lifetime, then run the normal
   all-target B promotion and retain maintenance after success.
7. Record exact run IDs, digests, probe evidence, unresolved blockers, and the separate conditions
   required to open the product. Opening uses a distinct UAT source C with B as the closed bridge.
