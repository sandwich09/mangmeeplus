# M-14 — Upload control corpus, isolated environment

Covers the first half of M-14's closure evidence: "EICAR/polyglot/SVG active-content/parser-bomb
tests ใน isolated environment". The live half (immutable revision deployed, quarantine and alarm
observed in production) is still open — see `docs/agent-memory/m14-clamav-provisioning.md`.

## What was run

`pnpm security:m14-evidence` (`scripts/m14-scanner-evidence.ts`). The corpus drives the shipped
upload controls directly — the same `inspectAttachmentBytes` policy and the same
`AttachmentMalwareScanner` INSTREAM client that `CompleteAttachmentUploadUseCase` calls — so the
result is about production code, not a re-implementation of it.

Layers under test:

- **META** — `validateAttachmentMeta`: MIME allowlist and size bounds, before any bytes are read.
- **CONTENT** — `inspectAttachmentBytes`: magic bytes, active content, PDF parser bounds.
- **AV** — `AttachmentMalwareScanner.assertClean` against a real clamd over INSTREAM.

## Isolation

| Property | Value |
| --- | --- |
| Scanner | `clamav/clamav:stable`, ClamAV 1.5.3, signature DB 28058 (2026-07-12) |
| Host | local Docker, published on `127.0.0.1:13310` only |
| Signature updates | disabled (`CLAMAV_NO_FRESHCLAMD=true`) |
| Production reachability | none — no S3, no production database, no production network |

```bash
docker run -d --name watchdog-m14-clamav --platform linux/amd64 \
  -e CLAMAV_NO_FRESHCLAMD=true -p 127.0.0.1:13310:3310 clamav/clamav:stable
CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=13310 pnpm security:m14-evidence
```

## Result — 28/28 PASS (2026-07-28)

```
PASS  [META] pdf within limits accepted :: allowed
PASS  [META] svg MIME refused :: MIME type "image/svg+xml" is not allowed.
PASS  [META] html MIME refused :: MIME type "text/html" is not allowed.
PASS  [META] office MIME refused :: MIME type "application/vnd.openxmlformats-officedocument.wordprocessingml.document" is not allowed.
PASS  [META] 26 MB refused :: File size must be between 1 byte and 26214400 bytes.
PASS  [META] zero bytes refused :: File size must be between 1 byte and 26214400 bytes.
PASS  [CONTENT] clean pdf passes :: accepted
PASS  [CONTENT] clean png passes :: accepted
PASS  [CONTENT] clean jpeg passes :: accepted
PASS  [CONTENT] eicar inside a pdf container :: Malware test signature detected.
PASS  [CONTENT] jpeg + html script polyglot :: Active content is not allowed in attachments.
PASS  [CONTENT] svg body declared as png :: File signature does not match the declared MIME type.
PASS  [CONTENT] svg smuggled into a real png :: Active content is not allowed in attachments.
PASS  [CONTENT] javascript: URI in a pdf :: Active content is not allowed in attachments.
PASS  [CONTENT] pdf /OpenAction + /JavaScript :: Active PDF content is not allowed.
PASS  [CONTENT] pdf /Launch action :: Active PDF content is not allowed.
PASS  [CONTENT] pdf /EmbeddedFile :: Active PDF content is not allowed.
PASS  [CONTENT] pdf object-count bomb :: PDF object count exceeds the parser safety limit.
PASS  [CONTENT] truncated jpeg without EOI :: File signature does not match the declared MIME type.

scanner: ClamAV 1.5.3/28058/Sun Jul 12 06:25:26 2026 at 127.0.0.1:13310

PASS  [AV] clean pdf scans CLEAN :: CLEAN
PASS  [AV] clean 5.1 MB pdf scans CLEAN (multi-chunk INSTREAM) :: CLEAN
PASS  [AV] raw eicar detected :: MALWARE_DETECTED
PASS  [AV] eicar + trailing whitespace still detected :: MALWARE_DETECTED
PASS  [AV] eicar in a pdf container: clamd passes it, CONTENT layer rejects it :: CLEAN
PASS  [AV] eicar in a real png: clamd passes it, CONTENT layer rejects it :: CLEAN
PASS  [AV] eicar in a real jpeg: clamd passes it, CONTENT layer rejects it :: CLEAN
PASS  [AV] unreachable scanner fails closed :: connect ECONNREFUSED 127.0.0.1:1

ALL CHECKS PASSED
```

## Findings worth carrying forward

**ClamAV does not detect EICAR embedded in a container, and that is by design.** EICAR is a
whole-file signature — the 68-byte string plus at most trailing whitespace — so ClamAV declines
to match it as a substring of a larger file. Confirmed independently of our client, with
`clamdscan` inside the scanner container:

```
/tmp/raw.txt:              Eicar-Test-Signature FOUND
/tmp/in.pdf:               OK
/tmp/trailing-newline.txt: Eicar-Signature FOUND
```

The PDF-wrapped payload is stopped by the `inspectAttachmentBytes` EICAR check instead, which
the CONTENT rows above show rejecting it. The two layers are complementary: that check must not
be deleted as "redundant with the AV scanner", because the scanner does not cover this case.

**The 64 KB INSTREAM chunking loop is exercised, not assumed.** A 5.1 MB PDF is framed across
~80 chunks and comes back CLEAN. A mis-framed stream would not: clamd rejects a malformed
INSTREAM rather than returning a clean verdict, so CLEAN here means the whole file was received
and scanned.

**An unreachable scanner fails closed.** Pointed at a dead port, `assertClean` rejects with
`ECONNREFUSED` rather than returning clean, so `CompleteAttachmentUploadUseCase` quarantines and
the object never reaches ACTIVE. This is why `CLAMAV_HOST` must stay unset until a real scanner
answers — a host that resolves to nothing breaks uploads instead of blocking the deploy.

## Still open for M-14 live closure

- Provision the private ClamAV service (blocked on an IAM grant — see the agent-memory note).
- Set `CLAMAV_HOST`, deploy an immutable revision, re-run this corpus against it.
- Observe in production: quarantine row, HIGH-risk `attachment.upload.rejected` audit event, the
  security alarm firing, and no ACTIVE object for a rejected upload.
