# W14 synthetic reliability assets

These are deterministic, repository-authored fixtures for the draft W14 corpus. They contain no customer data and are not seeded in any environment.

- `receipt-clear.png`: one-page canonical synthetic receipt with merchant, gross total, VAT component, and date labels.
- `receipt-partial.pdf`: two-page synthetic receipt; page 2 is explicitly partial.
- `document-unreadable.pdf`: two-page synthetic document; page 2 is intentionally unreadable.
- `*.label.json`: draft source-field labels. `labelledBy` and `provenance.reviewedBy` are null; no provider/native LINE acceptance is claimed.

Every label declares `expectedZeroQaFinancialWrites: true` for question-only routes. The corpus generator writes the bytes with standard-library encoders, hashes those exact bytes, and freezes both file and label digests in the corpus artifact. Human review, production fixture seeding, provider acceptance, and native LINE acceptance remain open gates.
