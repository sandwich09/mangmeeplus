# OCR round C plan

Spec: [OCR round C](../specs/ocr-round-c-spec.md). Small corrections to existing capture architecture.

- [x] Verify LINE file → guarded persistence → page capture → ordinary result card; queue pending PDFs.
- [x] Correct VAT reconciliation and issuer admission/merge, retaining printed evidence and review gates.
- [x] Retry receipt/capture extraction timeouts once; align shared receipt money/time bounds.
- [x] Resolve OCR vendor name through the existing company counterparty seam; preserve raw OCR/review.
- [x] Add cases to registered specs; build contracts, typecheck API/gateway, run required suites.
- [x] Record final evidence/doubts in task memory and a report of at most 40 lines; leave diff uncommitted.
