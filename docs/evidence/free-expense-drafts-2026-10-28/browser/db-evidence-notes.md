# Local browser database evidence

These files contain synthetic fixture data only. No environment file, password, session token or cloud credential is included. The API ran the current local source build against a disposable clone of the existing fake demo database. PostgreSQL, Redis and versioned object storage were local services. Original demo data and the original fixture counters were not reset.

- `db-baseline.json`: original five-company snapshot, before browser uploads. The zero cohort had zero successful reads and no local OCR fixture calls. The used-two source edit had already been clicked before this snapshot.
- `db-followup-baseline.json`: all seven companies after adding neutral notice and realistic paid-expired fixtures, before the final third-document notice test. Original counters were preserved.
- `db-final.json`: read-only repeatable-read snapshot after the reported desktop/mobile clicks, quota refusals and post-limit mobile source save.
- `db-comparison.json`: both comparisons, scoped to their common cohorts, plus explicit count and source-save assertions. Newly seeded cohorts are identified rather than compared against a nonexistent earlier baseline.
- `local-ocr-fixture-stats.json`: calls to the deterministic local HTTP OCR fixture. Its self-check is excluded. These are five local fixture calls and zero actual external model calls; the fixture returned usage[] because it called no model. Auth, upload validation, object storage, quota reservations, source persistence and permission checks ran through the real API and database.

Each JSON has a SHA256 sidecar. Both snapshot comparisons passed: expense payment, accounting document, journal entry, counterparty, paid receipt grant and historical billing-invoice counts were unchanged. No new expense was confirmed. The realistic paid-expired fixture intentionally already contained one historical paid invoice, and this remained unchanged.

Browser upload counts match database and fixture-call deltas exactly:

| Cohort | New local OCR calls | New source rows | New attachment rows | Final free reads | In flight |
| --- | ---: | ---: | ---: | ---: | ---: |
| fresh zero | 3 | 3 | 3 | 3 | 0 |
| seeded used-two | 1 | 1 | 1 | 3 | 0 |
| neutral notice used-two | 1 | 1 | 1 | 3 | 0 |

The blocked fourth attempts in the fresh-zero and neutral-notice cohorts produced no extra local OCR call, source row or attachment row. The mobile source-purpose edit after the limit is persisted on expense `cmvs9iq7t001frkk10f5agz0c` as `แก้ร่างหลังครบ 3 ใบจากหน้าจอมือถือ`; its status remains NEEDS_REVIEW, paid amount zero and official expense number absent.

The original `free-ui-paid-expired` fixture deliberately used a zero-day trial-shaped current term plus retained historical paid invoice to verify that losing the current paid mapping does not restore free eligibility. Its no-package notice reflects that inconsistent fixture. The additional `free-ui-paid-real` fixture uses STARTER_249 with an expired January1–February1 term and paid history, and returns the ordinary expired-plan notice without a free flag.

The password-only no-membership fixture represents existing credentials with no usable membership. It does not establish anonymous/native LINE guest signup coverage. These local browser artifacts do not establish a live release, native LINE device behavior or real model accuracy.
