# Plan: Fix "Failed to fetch" on attachment upload

Status: IMPLEMENTED — 2026-07-29
Owner: Claude (harness engineer) → Codex (implementation)
Reported: saving a reimbursement draft with a receipt → `บันทึกร่างแล้ว แต่แนบไฟล์ไม่สำเร็จ: Failed to fetch`
Scope: `apps/web` (port existing CSP fix + extend for self-hosted storage), `apps/api` (presign endpoint), `infra/docker`

## Diagnosis

`Failed to fetch` is a browser network-level failure — the request never reached a server, so it is not an
API error. The upload is a direct browser `PUT` to a presigned URL (`reimbursements.api.ts:39`, and the
identical helper in `expenses.api.ts:64`), so there are exactly two ways it can die: the browser is not
allowed to make the request (CSP), or the host in the URL is not reachable.

**Both are real here, and they are different bugs.**

### Half 1 — already fixed on `origin/develop`, not yet on this branch

That branch (`0bfd212`, 56 commits ahead) adds `buildS3UploadOrigin(bucket, region)` to
`security-headers.logic.ts` and wires it into `proxy.ts:35-40`, so the S3 bucket origin lands in CSP
`connect-src`. Without it, production emits only:

```
connect-src 'self' <NEXT_PUBLIC_API_BASE_URL> <NEXT_PUBLIC_API_URL> <NEXT_PUBLIC_AI_GATEWAY_BASE_URL>
```

and the browser blocks the upload. This is the AWS/UAT case and the fix is correct — **port it verbatim**,
do not reimplement it.

### Half 2 — not fixed anywhere, and it is what breaks local

`buildS3UploadOrigin` only produces AWS-shaped origins (`https://{bucket}.s3.{region}.amazonaws.com`) and
validates the region against `/^[a-z0-9]+(?:-[a-z0-9]+)+$/`. Checked against the repo's own
`.env.example` values:

| input | result |
|---|---|
| bucket `watchdog-bms-local` | valid |
| region `local` | **invalid** — the regex requires a hyphen |
| → `buildS3UploadOrigin(...)` | **`undefined`** — no storage origin enters CSP at all |

So for a self-hosted MinIO the ported fix contributes nothing.

Separately, the S3 adapter is untouched on that branch. It presigns from a single client built with
`config.s3Endpoint` (`s3-storage.adapter.ts:26-28`), and `infra/docker/compose.local.yml:78,248` sets:

```yaml
S3_ENDPOINT: http://minio:9000     # docker-internal hostname
```

while MinIO is published to the host only as `127.0.0.1:${MINIO_API_PORT:-19000}` (`:37`). Running under
compose, the API therefore hands the browser a URL pointing at a hostname the browser cannot resolve.

(`.env.example` sets `S3_ENDPOINT=http://localhost:19000`, which is browser-reachable — so a host-run API
avoids this. Only the compose path is broken.)

### Blast radius

`reimbursements.api.ts:31` and `expenses.api.ts` share the same three-step intent flow, so **every**
attachment upload fails identically. This very likely explains the evidence-panel screenshot where 24 of 30
confirmed documents showed `ไม่มีไฟล์`. `createDownloadUrl` (`s3-storage.adapter.ts:64-75`) presigns from
the same client, so viewing and downloading attachments break the same way.

## Fix

### A. Port the existing CSP fix — verbatim

Take these three files from `origin/develop` as-is:

- `apps/web/src/common/security/security-headers.logic.ts` (adds `buildS3UploadOrigin`)
- `apps/web/proxy.ts` (adds it to the `connectUrls` array)
- `apps/web/src/common/security/security-headers.logic.spec.ts` (its specs, including the injection cases)

Do not rewrite, rename, or "improve" them — this is an adopt, and keeping them identical keeps the branches
mergeable. Resolve only genuine conflicts with work already on this branch.

### B. Extend CSP to cover a configured storage endpoint

`buildS3UploadOrigin` stays exactly as ported and keeps owning the AWS-shaped case. Add a **separate**
small function next to it that turns a configured endpoint URL into an origin — same defensive posture as
the ported code: parse with `URL`, accept only `http:`/`https:`, return `undefined` on anything else, so a
malformed value can never inject a CSP directive.

Wire its result into the same `connectUrls` array in `proxy.ts`, from the storage endpoint env var. Both
entries coexist: AWS deployments get the bucket origin, self-hosted deployments get the endpoint origin,
and `buildContentSecurityPolicy` already de-duplicates and drops `undefined`.

Note for the record: production also emits `upgrade-insecure-requests`, so a production storage endpoint
must be `https` — an `http://` presigned URL would be rewritten and its signature broken.

### C. Presign against a browser-reachable endpoint

Add optional `S3_PUBLIC_ENDPOINT` to the API config schema and `AppConfigService` (next to `s3Endpoint`,
`app-config.service.ts:62`).

In `S3StorageAdapter`, keep the existing client for server-side operations and build **one** additional
presigning client in the constructor with `endpoint: config.s3PublicEndpoint || config.s3Endpoint`. Use it
for both `createUploadIntent` and `createDownloadUrl`.

The fallback is what makes this safe: with `S3_PUBLIC_ENDPOINT` unset the output is byte-identical to
today, so AWS (where `S3_ENDPOINT` is undefined and the SDK builds public URLs itself) and every existing
deployment are untouched. Do not construct a client per call.

### D. Point local docker at the published port

In `infra/docker/compose.local.yml`, add to the API service wherever `S3_ENDPOINT` is set (two places,
`:78` and `:248`):

```yaml
S3_PUBLIC_ENDPOINT: http://127.0.0.1:${MINIO_API_PORT:-19000}
```

Keep `S3_ENDPOINT: http://minio:9000` — the API's own container-to-container calls must keep using it.

If MinIO rejects the cross-origin `PUT`, add the bucket CORS rule in the existing `minio-create-bucket`
init service rather than anywhere else.

### E. Make the failure legible

`Failed to fetch` tells the user nothing. In the shared upload helper, catch a `TypeError` from the
direct-to-storage `fetch` and rethrow an actionable Thai message — that the file server could not be
reached and the record was saved without the attachment.

Keep the current behavior of preserving the draft on upload failure (`ReimbursementsPages.tsx:547-551`);
losing the user's typed lines would be worse. Say the draft is safe and the file can be attached by editing
it.

## Constraints

- No Prisma migration; no schema change; no new dependency.
- `S3_PUBLIC_ENDPOINT` unset must behave exactly as today.
- §A is a port. Divergence from `origin/develop` in those three files is a defect, not a style choice.
- Do not change the three-step intent flow, attachment permissions, or retention rules.
- Do not touch the expense row-actions / hard-delete work in flight on this branch.

## Verification

1. `corepack pnpm --filter @watchdog-bms/api test` — run **alone** (`line-message-buffer.service.spec.ts` flakes under CPU contention); 0 fail
2. `corepack pnpm --filter @watchdog-bms/web test` / `typecheck` / `build`
3. `corepack pnpm config:validate` if the config schema gained a field
4. Ported specs from §A pass unmodified
5. New spec: a configured `http://localhost:19000` endpoint appears in `connect-src`; a malformed endpoint yields no directive
6. Adapter spec: with `S3_PUBLIC_ENDPOINT` set, upload and download URLs carry the public host; unset, output is unchanged
7. Owner manual check (needs a running stack): attach a receipt on a reimbursement draft, confirm the PUT returns 200 and the line shows the attachment

Baseline before this work: API 0 fail, web 479 pass / 0 fail.

## Out of scope

Migrating to server-proxied uploads, changing storage providers, attachment retention, and
`local-storage.adapter.ts` (which serves relative URLs through the API and is unaffected).
