# Sales payment — stable retry evidence

2026-08-27; local web3000/API3001; branch `codex/sales-payment-stable-retry`.
This is capture-first receive-payment integrity, not bank reconciliation.

## Real browser write and server readback

`e2e/accounting.spec.ts` ACCT-06 uses a real QA FINANCE session, creates its own
customer/invoice250, forwards the actual browser payment POST to the server, and
intentionally loses only the first successful response. It then retries from390×844
after advancing the client clock61 seconds (first attempt1280×900).

| Check | Before retry | After retry |
| --- | --- | --- |
| Payment count / ID | 1 / `cmtaykkle00a1tak1m61xfk81` | Same |
| Received money / WHT | 97 / 3 | 97 / 3 |
| Allocated money / unapplied | 97 / 0 | 97 / 0 |
| Invoice paid / outstanding | 100 / 150 | 100 / 150 |

Both actual request bodies, idempotency keys and paid timestamps match byte-for-byte.
The test verifies zero unhandled browser exceptions. A transport error is deliberately
shown for the lost response, then disappears after successful replay and toast expiry.

- [Exact API/request readback extracted from the generated test attachment](payment-retry-readback.json)
- [Lost-response desktop panel](lost-response-desktop.png)
- [Successful replay mobile panel](replayed-payment-mobile.png)

These two PNGs are element captures; sticky page chrome can overlap the tall element.
Readback and assertions are the numeric proof. After capture, the test voids only
its own payment/invoice and archives its unique customer through supported APIs.
The JSON represents the state **before** that cleanup, not current live balances.

## Separate real Chrome UI inspection

- [Desktop1280×900 form, not submitted](chrome-desktop-form-unsubmitted.jpg)
- [Mobile390×844 form, not submitted](chrome-mobile-form-unsubmitted.jpg)

Selected the existing local `INV-202608-00031`, typed example97+3, checked the displayed
100 against432.10 and keyboard focus without submitting. No horizontal page overflow;
empty warning/error log. No existing financial record was changed. This is viewport
testing, not physical-device certification or complete P24 acceptance; persistent
visible labels in this legacy form remain a separate UX follow-up.

## Reproduce

With the local API/web serving this branch and QA FINANCE/sales availability ready:

```sh
PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_JSON_OUTPUT_FILE=test-results/accounting-report.json pnpm exec playwright test e2e/accounting.spec.ts --project=chromium --workers=1 --reporter=list,html,json
```

Final result: **6/6 passed**. Web unit suite1127/1127, web typecheck and diff check passed.
The HTML/JSON reports are generated local artifacts, not release manifests.
See [memory](../../agent-memory/sales-payment-stable-retry.md) for the initial stale-selector
failure, subsequent passes, scope and fixture disposition.
