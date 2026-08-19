# Agent Memory: UAT AI not responding (PDF OCR prefill + LINE reply)

Status: Employee LINE webhook repaired and accepted on UAT 2026-08-18; the historical PDF/CRM-OA items below remain separate.
Owner: Claude (investigation + fix)
Scope: UAT report "AI ไม่ตอบ" covering (a) expense receipt OCR prefill on PDF upload and (b) LINE AI not replying on either OA.

## Decisions

- The AI platform itself was NOT down. Readback from UAT deploy run `30167794331`
  (release `676122c1`) shows the ai-gateway container received `MODEL_PROVIDER=bedrock`,
  `BEDROCK_REGION=ap-southeast-1`, `BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6`,
  `LINE_AI_AGENT_RUNTIME=strands-local`, api-web received `CRM_AUTO_REPLY_ENABLED=true`,
  and both api-web and ai-gateway resolved real ECS URLs (no placeholder). The two
  symptoms have separate causes.
- PDF receipt OCR is implemented as a media-type branch on stage 1 only. Typhoon accepts an
  image data URI, so PDFs are read by a Bedrock Converse `document` block under the same
  `{"natural_text": md}` contract. Stage 2 and the §13 value cross-check are untouched:
  both media types still validate extracted numbers against verbatim read text.
- PDF stage 1 is Bedrock-only. `OpenAiProvider` has no document channel, so a non-bedrock
  `MODEL_PROVIDER` returns typed `PDF_PROVIDER_UNSUPPORTED` rather than silently handing a
  PDF to the image-only Typhoon API. Rejected adding a capability flag to `IModelProvider`
  for one caller.
- Rejected rendering PDF -> PNG server-side: needs a new rendering dependency, and Bedrock
  reads PDFs natively via the SDK already in use.
- PDF byte ceiling is 4MB (`MAX_PDF_EXTRACTION_BYTES`), below the ~4.5MB Converse document
  limit, so an oversized scan returns `unsupported` instead of an opaque provider error.
  Images keep the existing 10MB ceiling.
- `deploy-production.yml` has the same missing-`TYPHOON_OCR_API_KEY` wiring, but prod works
  today because the secret already exists in Secrets Manager and `secret_arn` finds it.
  Left alone deliberately: adding the line would let a wrong GitHub secret rotate the live
  prod key. Fix it in a dedicated change if prod ever needs to set it from CI.

## Open questions

- UAT has one LINE OA (`uat-mangmeeplus` / `@234jrspv`) whose webhook is set to the employee
  endpoint `/v1/line/webhook`. The CRM customer path is a different route
  (`/v1/crm/line/webhook/:webhookKey`) and a LINE OA carries only one webhook URL, so the
  two OA journeys cannot both be live on one channel. Needs an owner decision: a second UAT
  OA, or test the two paths one at a time.
- Whether the UAT test company has `CompanyMessagingChannel.autoReplyEnabled = true` and a
  `CompanyFeatureEntitlement` row set including `ai_line_assistant` — both unreadable from
  this workstation (no AWS/DB credentials).

## Artifacts

Code:
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port.ts` — `documents` on `ProviderInput`
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts` — Converse document blocks
- `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts` — stage-1 media branch + `PDF_OCR_PROMPT`
- `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts` — accept PDF, PDF byte ceiling
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` — accept PDF on the LINE receipt path
- `.github/workflows/deploy-uat.yml` — pass `TYPHOON_OCR_API_KEY`

Tests:
- `apps/ai-gateway/.../bedrock.provider.spec.ts` — document block wire shape + name charset
- `apps/ai-gateway/.../line-ai-internal.controller.spec.ts` — PDF never reaches Typhoon
- `apps/api/.../expense-extraction.use-case.spec.ts` — PDF reaches the gateway; oversized PDF and other media types stay `unsupported`

## Verification

| Command | Result |
|---|---|
| `pnpm --filter @watchdog-bms/ai-gateway typecheck` | PASS |
| `pnpm --filter @watchdog-bms/api typecheck` | PASS (after `prisma generate`; the checked-in client was stale and failed on unrelated CRM/employee models) |
| `pnpm --filter @watchdog-bms/ai-gateway test` | 419/419 pass, 0 fail |
| `pnpm --filter @watchdog-bms/api test` | 2188/2188 pass, 0 fail |

Not run: live PDF OCR against Bedrock. The workstation has no valid AWS credentials, so the
PDF stage-1 round trip is covered by the wire-shape test only and still needs one real UAT upload.

## Deploy outcome (2026-07-25)

GitHub Actions ran out of free-tier minutes mid-rollout (2,000/2,000 used on the Free plan,
resets ~Aug 1), so `ai-gateway` and `workers` were deployed manually instead:

- Images were NOT rebuilt. CI had already published all three to ECR for `244c853e` before
  the quota ran out, so the `image-*.json` run artifacts were reassembled into a
  `production-image-manifest.json` with the same jq CI uses, checked with the repo's own
  `infra/docker/validate-production-manifest.sh`, and fed to `deploy.sh` via
  `PRODUCTION_IMAGE_MANIFEST`. No Docker daemon needed.
- `deploy.sh` sources the repo-root `.env`, whose values override the caller's environment.
  Two lines were appended for the run and reverted after: `BEDROCK_MODEL_ID` pinned back to
  `global.anthropic.claude-sonnet-4-6` (local `.env` has haiku-4-5, which would have silently
  downgraded UAT), and `TYPHOON_OCR_API_KEY` blanked so `put_secret` could not overwrite the
  existing UAT secret.

`api-web` additionally needed the release task, whose image (`apps/api/Dockerfile --target
local`) is built inside the CI deploy job and so never existed for this SHA. It was built and
pushed manually (`linux/amd64` under emulation), verified with CI's own checks — image label
`org.opencontainers.image.revision` equals the source SHA, and `prisma validate` passes inside
the container — then run on Fargate: `74 migrations found / No pending migrations to apply`,
`Permission sync complete: 321 permissions, 12 roles, 1234 grants`, address sync 7436 rows,
`release-task-complete sha=244c853eeea0`. That matches the diff, which touches no migrations,
no permission registry and no address data — the gate was satisfied honestly rather than by
exporting `RELEASE_TASKS_APPLIED_SHA` past it.

The api-web path also required replicating CI's `preserve` step by hand. The repo-root `.env`
holds PRODUCTION values — LINE login `2010676888`, messaging `2010677091`, LIFF
`2010676888-YnvoTDg5`, domain `mangmeeplus.com` — and would have silently repointed UAT at the
production OA and domain. Every preserved key was read from the live ECS config and pinned
before the run.

Verified from `describe-express-gateway-service`, not from the script's exit code:

| service | GIT_SHA | note |
|---|---|---|
| api-web | `244c853eeea0` | UAT LINE identity + domain intact; `AI_GATEWAY_INTERNAL_URL` on the new gateway |
| ai-gateway | `244c853eeea0` | `TYPHOON_OCR_API_KEY` now bound; `DOCUMENT_AI_MODEL_ID=sonnet-4-6` |
| workers | `244c853eeea0` | |

Health: ai-gateway `/v1/health` 200, `uat.mangmeeplus.com/v1/health` 200 (one probe each,
after the deployment reported stable — never during canary bake).

### LIFF account-link URL corrected

`LINE_ACCOUNT_LINK_URL` was still the production LIFF (`https://liff.line.me/2010676888-YnvoTDg5`).
Root cause: the GitHub `uat` environment has no `WEB_LINE_ACCOUNT_LINK_URL` variable, so CI's
`preserve` re-read the stale value from ECS and wrote it back every single run — a self-sustaining
loop. Fixed by deploying once with `WEB_LINE_ACCOUNT_LINK_URL` empty, which makes `deploy.sh`
derive `https://liff.line.me/$LINE_LIFF_ID` (deploy.sh:609-612). Now
`https://liff.line.me/2010784350-ruzn5beM` on both `LINE_ACCOUNT_LINK_URL` and
`NEXT_PUBLIC_LINE_ACCOUNT_LINK_URL`; CI will preserve the corrected value from here on.

Still open on the LINE side: the LIFF app `2010784350-ruzn5beM` has its **Endpoint URL set in the
LINE Developers console**, which per `uat-environment.md` still resolves to
`https://mangmeeplus.com/v1/auth/line/link-page`. That is console state, not deployable config.

## Defect found in deploy.sh (affects production too)

`deploy_express_service` treats an empty `update-express-gateway-service` result as a
successful no-op (`infra/prod-ecs-express/deploy.sh:588-595`). When the call fails with
AccessDenied it writes to stderr, returns nothing on stdout, and the script prints
`update was a no-op; service is already stable`, prints the service URL, and exits 0. A
first manual attempt hit exactly this: nothing deployed, exit 0. The same code path runs for
production deploys, so a permissions regression there would report green. The
`no-op` line is also printed on runs that DID deploy, so it carries no signal either way —
always verify `GIT_SHA` from ECS.

## Symptom confirmed (2026-07-26)

Owner UAT-tested add-employee: the final-step LINE QR "cannot be scanned" (ไม่สามารถสแกนได้).
Diagnosis session verified everything deployable is correct — the QR image decodes at all
rendered sizes (CIDetector, including the 144px UI size), the embedded URL is
`https://uat.mangmeeplus.com/v1/auth/line/link-page/employee?token=…`, and the live page
serves `data-liff-id=2010784350-ruzn5beM`, `data-api-base=https://uat.mangmeeplus.com/v1`,
OA `@234jrspv`. The failure is the open item below: the page auto-runs
`liff.login({redirectUri: location.href})`, and the LIFF app's console-registered Endpoint
URL still points at `https://mangmeeplus.com/v1/auth/line/link-page` (production), so LINE
rejects the uat.mangmeeplus.com redirectUri. Fix is console-side only: LINE Developers →
login channel `2010784350` → LIFF `2010784350-ruzn5beM` → Endpoint URL →
`https://uat.mangmeeplus.com/v1/auth/line/link-page`, then issue a fresh QR (15-min token TTL).

## Next

1. `api-web` is still on `6059aad4` and is missing the three employee-access commits in
   `244c853e`. Its `deploy_api_web` path is gated by `require_api_release_tasks`, which needs
   the release task run for the target SHA (that image is built in the CI deploy job and was
   never published, so it needs Docker locally). Easiest route is GitHub Actions once billing
   is restored: `gh run rerun 30171000686 --failed`.
2. Upload one real PDF bill and one JPEG receipt in UAT; expect prefilled fields with the
   draft still `NEEDS_REVIEW`. Both paths should now work.
3. LINE: decide the single-OA conflict above, then verify `autoReplyEnabled` on the channel
   and the `ai_line_assistant` entitlement for the test company before re-testing.
4. GitHub Actions Free tier is the binding constraint on deploys. The workflow rebuilds all
   six images on every run; worth trimming if CI stays on the free plan.

## Receipt OCR global-Sonnet follow-up (2026-07-29)

- UAT receipt `cms5v60qe005n1v5qgc9wmww7` ran extraction three times. API requests completed
  normally in 5–7 seconds, while AI Gateway usage logs returned
  `PROVIDER_ACCESS_NOT_READY` for
  `apac.anthropic.claude-3-5-sonnet-20241022-v2:0` on every attempt.
- Live ECS revisions confirmed UAT was still configured with that APAC model for
  `BEDROCK_MODEL_ID`, `DOCUMENT_AI_MODEL_ID`, and `APPROVED_AI_MODEL_IDS`. Typhoon reading
  succeeded; the stage-2 Bedrock call failed.
- Root cause: the GitHub `uat` environment lacked
  `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF`, so `deploy.sh` deliberately ignored the
  otherwise-present `DOCUMENT_AI_MODEL_ID=global.anthropic.claude-sonnet-4-6` variable and
  selected its regional fallback.
- Set the existing approved reference `DPO-2026-07-23-bedrock-global` on the GitHub `uat`
  environment and dispatched UAT/all release `51a637ca0b2d679bc1494972f5e0f7ecd422d09f`
  (run `30439342211`). Image publishing passed, but the deploy job failed before any AWS
  mutation because the reusable CI skipped `Production Digest Manifest`; consequently
  `production-release-51a637ca...` did not exist for `download-artifact`.
- Applied a configuration-only ECS Express update after the existing `51a637ca` rollout
  reached `SUCCESSFUL`. Payload comparison proved the image, roles, networking, secrets,
  scaling, and all unrelated environment values were unchanged. Deployment
  `sqgUX-6V18tYaQxrKzLbi` completed `SUCCESSFUL`, with monitoring complete and no triggered
  rollback alarm.
- Live revision `4380986209823873303` now reports
  `BEDROCK_MODEL_ID=DOCUMENT_AI_MODEL_ID=APPROVED_AI_MODEL_IDS=global.anthropic.claude-sonnet-4-6`,
  `AI_GLOBAL_INFERENCE_PROFILE_APPROVED=true`, and approval reference
  `DPO-2026-07-23-bedrock-global`; `/v1/health` returned `status: ok`.
- A synthetic 15-token Bedrock `Converse` request to the same global profile returned `OK`,
  confirming account/provider access. End-to-end verification of the original receipt still
  requires an authenticated UAT user to press `อ่านเอกสารอีกครั้ง`, then confirm the next
  `ocr.receipt.extract` usage record has `ok: true`.

## Employee LIFF mobile-browser follow-up (2026-07-29)

The UAT LIFF endpoint is now correctly registered as
`https://uat.mangmeeplus.com/v1/auth/line/link-page`, but employee QR packages still encoded
the raw UAT page URL. Android therefore opened the QR in Samsung Internet, where `liff.init()`
showed LINE's generic unknown-error dialog before account linking. Server-generated employee
and owner QR packages now prefer `https://liff.line.me/<LINE_LIFF_ID>/employee?token=...`,
which opens through LINE/LIFF on mobile; the raw API page remains only as the local fallback.

## Employee LINE webhook recovery (2026-08-18)

- The newly created `ป๋อจ้าน Company` had one active membership and one active LINE identity.
  The identity was stored against the current UAT Messaging channel, was reachable through the
  UAT OA profile API, and the company context was correct. No webhook event arrived after the
  20:30 ICT link, while earlier UAT test events had completed normally.
- UAT services were healthy on immutable source
  `75ae7e154591bf6464fe1c52ef66e0c6139e26e8` from Deploy UAT run `32091272835`;
  api-web, AI Gateway, and workers digests each carried the exact `git-<source>` tag. Public API,
  AI Gateway, and authenticated DB readiness returned HTTP 200.
- LINE readback showed the employee OA `uat-mangmeeplus` / `@234jrspv` active at
  `https://uat.mangmeeplus.com/v1/line/webhook`. A provider-side webhook test returned
  `REQUEST_TIMEOUT`, even though `GET /v1/health` through the same custom domain returned 200.
  Testing the canonical ECS Express URL from SSM plus `/v1/line/webhook` returned `200 OK`.
- Config-only repair: updated the LINE Messaging webhook endpoint to
  `/watchdog-bms/uat/ecs-express-api-web-url` + `/v1/line/webhook`. Immediate GET readback matched
  the exact endpoint with `active=true`, and LINE's configured-endpoint test returned
  `success=true`, `statusCode=200`, `reason=OK`. Production and UAT runtime services were not
  changed or redeployed.
- Whole-chain acceptance reused the existing signed synthetic webhook smoke against the linked
  LINE account. Event `smoke-query-1787060761165` reached terminal `completed` for the target
  company, cleared its recovery payload, and persisted an `AiTurn` as `COMPLETED` in 3,149 ms with
  no error. Completion is written only after LINE reply/push delivery succeeds, so this proves
  webhook -> identity/company -> AI -> outbound LINE delivery on the repaired path without reading
  or logging the reply content.
- Keep the direct SSM-derived UAT API endpoint until the custom-domain POST timeout is diagnosed.
  A custom-domain health GET is not sufficient webhook evidence; always run LINE's webhook test.

## Production employee LINE webhook recovery (2026-08-18)

- A read-only check found the same failure on the Production shared employee OA `มั่งมี Plus` /
  `@458wpnio`: its active endpoint `https://mangmeeplus.com/v1/line/webhook` returned
  `REQUEST_TIMEOUT` from LINE's provider test, while the canonical Production ECS Express API
  endpoint returned `success=true`, `statusCode=200`, `reason=OK`.
- After explicit owner authorization, the change guarded the exact bot id, exact old endpoint,
  active state, SSM origin shape, and a successful provider preflight before mutation. It updated
  only the LINE Messaging webhook endpoint to
  `/watchdog-bms/production/ecs-express-api-web-url` + `/v1/line/webhook`.
- Immediate readback matched the new endpoint with `active=true`; testing the configured endpoint
  returned `success=true`, `statusCode=200`, `reason=OK`. No ECS service, image, database,
  Production customer gate, Cloudflare configuration, or application code was changed.
- Scope is the shared employee LINE AI OA. Per-company CRM customer OA webhook endpoints were not
  inspected or changed. No synthetic business message was generated in Production; a real employee
  resend remains the customer-visible acceptance.
