# Plan: ข้อมูลบริษัทก่อนซื้อแพ็กเกจ

Spec: [billing-company-profile-gate-spec-th.md](../specs/billing-company-profile-gate-spec-th.md)

- [x] Shared readiness/name/address contract and snapshot validation; preserve name priority and optional fields.
- [x] Gate quote/new checkout and synchronize Stripe Customer for initial/restart/repeat/upgrade with current binding and safe failure/retry.
- [x] Missing-field popup, safe return path, selected package retention, company save→purchase review, document preview.
- [x] Inspect and close expired-owner repair access and existing paid/recovery compatibility.
- [ ] Run focused and surrounding regressions, local PostgreSQL/HTTP/browser, typechecks; review exact diff for bugs/gaps/impact.
- [ ] Commit scoped expense-summary/discovery/TSIC/profile-gate work; create PRs to main/develop, wait for exact-head CI, merge both and verify branch containment. No deploy.
