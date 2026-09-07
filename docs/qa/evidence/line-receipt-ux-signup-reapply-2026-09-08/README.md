# Receipt UX and rejected reapplication evidence

Local API-served LIFF browser acceptance: 7/7 PASS at 390px and 1280px. Screenshots below are synthetic LINE identity/status fixtures using the actual page, script and CSP; they do not claim a real LINE account was provisioned. PostgreSQL tests separately verify rejected history with changed email, actual manual approval, idempotency and support persistence.

- `rejected-reapply-false-390.png`: rejected applicant without a current shop.
- `rejected-reapply-true-390.png`: rejected applicant retains existing shop entry alongside reapplication.

Receipt fixtures in `process-line-webhook.use-case.spec.ts` prove PANDA MALA printed total300, hidden internal IDs and a neutral web action, plus complete fallback text beyond400 characters. `expense-source-draft.logic.spec.ts` proves the nested reconciliation contract for quantity0.63, total243.75 and persisted unit386.9048. This is application/provider-payload evidence; real LINE device rendering remains a UAT customer check.

See the task memory for exact test commands/results and the subsequent UAT run, digest and acceptance ledger. Production remains on hold.
