# Processor, Subprocessor, and Cross-Border Register

Status: **OPEN — production and vendor evidence incomplete**

Register date: 2026-08-09

Owners: Privacy / Legal, Procurement, Platform Security

Scope: personal-data recipients and processing services visible in this repository

This is the current evidence-control register. It deliberately separates code facts from
vendor promises and live production facts. A configured region string is not proof of a
vendor's storage, support-access, logging, abuse-monitoring, backup, or onward-transfer
location. A vendor name in code is not proof that an executed processor agreement exists.

## 1. Evidence-state rules

| State | Meaning |
|---|---|
| **[VERIFIED]** | Re-checkable in a cited repository file as of 2026-08-09. It proves a technical path/capability only, unless the evidence is a signed live export. |
| **[OBTAIN]** | Obtain the executed contract, dated official terms, current subprocessor list, live configuration export, deletion evidence, or other named artifact. |
| **[DECIDE]** | Accountable legal/business/privacy decision after the missing evidence is reviewed. |

No row is approved merely because it appears here. “Processor”, “subprocessor”,
“independent controller”, and “recipient” are legal roles that must match the contract
and real purpose.

## 2. Official Thai transfer sources

- [PDPA B.E. 2562, sections 28–29 (official Parliament copy)](https://odl.parliament.go.th/handle/20.500.13072/547319)
- [PDPC Notification under section 28 (official Royal Gazette PDF)](https://ratchakitcha.soc.go.th/documents/14915.pdf)
- [PDPC Notification under section 29 (official Royal Gazette PDF)](https://ratchakitcha.soc.go.th/documents/14913.pdf)

For each routine overseas vendor flow, record the exporter/importer and roles, every
destination and remote-access country, onward transfers, and a defensible mechanism:
adequacy under section 28; binding corporate rules or appropriate safeguards under
section 29; or a specifically applicable statutory exception. Appropriate safeguards
must preserve enforceable rights and effective remedies. An exception, including
consent, must not be used as a generic substitute for a routine vendor transfer
mechanism. ASEAN model contractual clauses or EU standard contractual clauses may be
useful contractual materials, but their existence and fit for the Thai transfer must be
reviewed and recorded rather than assumed.

## 3. Repository-derived inventory

### A. Likely external processing/recipient surfaces

| ID / service surface | Data and repository evidence | Live status / role | Location and transfer | Training, retention, deletion | Contracts / subprocessors | Required disposition |
|---|---|---|---|---|---|---|
| **V-01 AWS core infrastructure** — ECS/Fargate/Express Gateway, RDS/PostgreSQL, Redis endpoint, S3, CloudWatch Logs/alarms, SNS, Secrets Manager/SSM, ECR | `infra/prod-ecs-express/deploy.sh` configures these service surfaces; the API stores tenant records and uploaded files, and containers/logging can process request and operational metadata. S3 versioning and object delete permissions are configured. | **[VERIFIED]** deployment design. **[OBTAIN]** signed live service/account/region inventory and current Redis/RDS topology. **[DECIDE]** processor/subprocessor roles per service and support purpose. | Deployment variables default to `ap-southeast-1`, but that is not proof that all storage, backup, support, telemetry, or disaster-recovery access stays there. **[OBTAIN]** live regions and AWS service data-location/support-access evidence. **[DECIDE]** sections 28–29 mechanism. | Production deploy code fixes CloudWatch application log retention at 90 days. `infra/object-storage-lifecycle.json` expires the current `pending/` object after 1 day and its noncurrent byte version after 1 further day; `report-export/` expires after 7 days with noncurrent versions removed 1 day later. This does not prove lifecycle for final evidence objects or DB/backups. **[OBTAIN]** RDS/Redis/S3-version/backups/logs/deletion schedule and deletion drill. | **[OBTAIN]** executed AWS DPA/service terms, account entity, current subprocessor/onward-transfer terms, security annex, audit evidence, and termination/deletion terms. | **HOLD evidence closure** until live inventory, contract, transfer assessment, and retention/deletion evidence are approved. |
| **V-02 AWS Bedrock and AgentCore** | `bedrock.provider.ts` sends prompts, conversation context, tool results, images/PDFs to Bedrock Converse. `agentcore-runtime.client.ts` sends a serialized request to an AgentCore runtime. Production deploy code pins `global.anthropic.claude-sonnet-4-6` for chat/document roles and requires an approval reference. | **[VERIFIED]** callable paths and deploy intent. A deploy script is not live-state proof. **[OBTAIN]** running task/model/profile/region export and AgentCore runtime configuration. **[DECIDE]** AWS/underlying-model-provider roles. | A `global.` inference profile is deliberately not treated as region-pinned by the code's approval control. Exact routing, storage, support, and onward-transfer countries are not in the repo. **[OBTAIN]**, then **[DECIDE]** mechanism per path. | The requests contain no repository-visible provider training/retention agreement. Local `AI_DATA_RETENTION_DAYS` controls MangmeePlus data, not AWS/provider copies. **[OBTAIN]** training/use, abuse monitoring, human review, transient/persistent logs, opt-out, deletion, backup, and zero-retention eligibility terms for the exact account/service/model. | **[OBTAIN]** executed AWS AI/service terms, DPA, model-provider relationship, current subprocessor list, global-routing documentation, and any account-specific approval. | **Do not rely on the old approval narrative alone.** Attach the actual resolution plus vendor and transfer evidence before treating global routing as approved. |
| **V-03 LINE Login, LIFF, Messaging API, media/profile delivery, and LINE CDN** | Auth and CRM code calls LINE verification/profile/messaging/media endpoints and can send recipient IDs and message text; LIFF and sticker/static CDN surfaces are referenced in API/web code. | **[VERIFIED]** integration. **[OBTAIN]** live LINE accounts/channels, enabled features, and data-flow export. **[DECIDE]** LINE's roles for login, messaging, profile/media, and CDN. | Countries, remote access, CDN/log locations, and onward transfers are not established by code. **[OBTAIN]** then **[DECIDE]** sections 28–29 treatment. | Repository retry/purge controls do not establish LINE's retention or deletion. **[OBTAIN]** message/media/profile/log retention, user-deletion/disconnection, backup, and support processes. | **[OBTAIN]** executed/applicable LINE terms, privacy/data-processing terms, subprocessor list, data-location statement, security evidence, and termination obligations. | Approve each LINE purpose and notice wording only after the evidence is versioned. |
| **V-04 Typhoon OCR / OpenTyphoon API** | `typhoon-ocr.client.ts` posts a prompt and full JPEG/PNG base64 content to `https://api.opentyphoon.ai/v1/chat/completions`. Config requires a declared `TYPHOON_PROCESSING_REGION` when enabled. | **[VERIFIED]** full-image API path. A client-side region label does not prove provider enforcement. **[OBTAIN]** live enablement, account/plan, exact model, and provider-side region control. **[DECIDE]** legal role. | Exact processing/storage/support/subprocessor countries are absent. **[OBTAIN]** and **[DECIDE]** sections 28–29 mechanism. | No request-side training, retention, deletion, or zero-retention control is visible. **[OBTAIN]** binding training/use, retention, abuse-monitoring/human-review, deletion, backup, and incident terms. | **[OBTAIN]** executed DPA/order form, service/privacy terms, subprocessor list, security annex/certifications, SLA, breach notice, and termination/deletion certificate route. | **Do not send production personal data** until contract, location, transfer, and AI-use/retention fields are approved. |
| **V-05 Cloudflare reverse-proxy workers** | `infra/cloudflare/mangmee-host-proxy.worker.js` and the UAT worker forward request method, headers, and body to an origin and rewrite redirects. | **[VERIFIED]** worker design. **[OBTAIN]** live routes, zones, account, worker version, cache/log/analytics/security products, and whether production traffic actually traverses it. **[DECIDE]** role per enabled product. | Edge and support locations cannot be inferred from the script. **[OBTAIN]** localization/region controls, remote access, and subprocessors; **[DECIDE]** transfer mechanism. | The script does not establish provider request/log/cache/WAF/analytics retention or deletion. **[OBTAIN]** live settings and contractual schedules. | **[OBTAIN]** executed DPA/terms/order, subprocessor list, security annex, breach and deletion obligations. | Do not claim localization/no storage based only on a pass-through worker. Close live-settings and contract evidence. |
| **V-06 OpenAI Responses API — optional provider path** | `openai.provider.ts` posts messages/images/tool results to `https://api.openai.com/v1/responses`. `packages/config/src/index.ts` permits `MODEL_PROVIDER=openai` with key/region/allowlist controls. The request code does not visibly send a `store` setting. | **[VERIFIED]** callable optional path. Production deploy script currently intends Bedrock; **[OBTAIN]** live tasks/secrets/telemetry to establish whether OpenAI has ever been enabled. **[DECIDE]** role before use. | A configured `OPENAI_PROCESSING_REGION` is an internal declaration, not provider-side residency evidence. **[OBTAIN]** account-project residency/routing/support/subprocessor countries; **[DECIDE]** transfer mechanism. | Absence of a request flag proves neither zero retention nor no training. **[OBTAIN]** exact API/account terms for training, abuse monitoring, storage, human review, deletion, backups, and zero-data-retention eligibility/approval. | **[OBTAIN]** executed OpenAI agreement/DPA/order, applicable service terms, subprocessor list, security annex, and account settings export. | Keep disabled for production personal data until all evidence and approval fields close. Remove from approved defaults if the business does not intend to support it. |
| **V-07 GitHub / CI-CD and source repository** | `.github/workflows` and deployment material show GitHub-based source/automation surfaces. Source, employee identity, CI logs, build artifacts, and secrets references may be processed; application personal data is not intended. | **[VERIFIED]** operational surface. **[OBTAIN]** organization/repository plan, apps/actions, artifact/log settings, runner type, access list, and a check for accidental production-data logging. **[DECIDE]** role/scope. | **[OBTAIN]** storage/support/subprocessor countries and contractual safeguards if personal data is in scope. | **[OBTAIN]** logs/artifacts/caches/audit retention and deletion/offboarding evidence. | **[OBTAIN]** applicable enterprise/standard DPA and third-party Actions/app inventory. | Minimize CI data; close as an employee/developer-data processor and prohibit production personal-data fixtures/logs. |
| **V-08 Tenant-configured workflow webhook destinations** | Workflow code allows an authorized tenant admin to configure an allowlisted URL and sends signed event payloads. Payloads can include `companyId`, event type, source module/type/id, and time; identifiers can be personal data when linkable. New endpoints start disabled. | **[VERIFIED]** recipient path and control design. A destination may be a tenant's processor, another controller, or the tenant itself; it is not one fixed MangmeePlus vendor. **[DECIDE]** per endpoint/tenant instruction. | **[OBTAIN]** destination entity, host, country, onward transfers, and tenant instruction before enabling. | **[OBTAIN]** recipient retention/deletion and incident contact. | **[OBTAIN]** tenant's documented instruction/authorization and, where MangmeePlus chooses the recipient, appropriate contract and subprocessor approval. | Maintain a live per-endpoint recipient register; disclose payload fields; require re-approval on URL/host/event-scope changes. |

### B. Excluded, inactive, or internal surfaces that still need a boundary record

| ID / surface | Repository finding | Status / action |
|---|---|---|
| **X-01 Amazon SES email** | `EMAIL_PROVIDER` accepts `ses`, but `apps/api/src/modules/auth/auth.module.ts` treats SES as not implemented and nonlocal operation uses a disabled mailer. | **[VERIFIED]** config-only/inactive in the inspected code. Do not list SES as an active personal-data recipient and do not enable it without onboarding it into this register. **[OBTAIN]** live configuration to confirm disabled. |
| **X-02 ClamAV malware scanning** | Runtime/runbook material describes a co-located/local ClamAV scanner rather than a hosted external API. | **[VERIFIED]** design intent only. **[OBTAIN]** live topology/image/SBOM and egress proof. If co-located with no external submission, record as an internal component, not a subprocessor. Reclassify if a managed scanner or remote signature/analysis service receives files. |
| **X-03 Exchange-rate API** | `apps/api/src/modules/line-ai/application/ai-fx-rate.ts` fetches `https://open.er-api.com/v6/latest/USD`; request shape contains no application personal-data payload. | **[VERIFIED]** no app personal data in the request body/URL. Provider still receives ordinary network metadata. **[DECIDE]** whether it belongs only in the general third-party/security inventory; prohibit adding tenant/user identifiers. |
| **X-04 Google Maps location link** | Web logic creates a user-clicked URL containing latitude/longitude. Google receives the coordinates plus browser/network metadata when the user opens it. | **[VERIFIED]** external-recipient link. **[DECIDE]** notice/UX treatment and whether tenant/customer location data is involved. **[OBTAIN]** applicable terms only if MangmeePlus embeds or systematically integrates the service beyond a user-initiated link. |

This inventory is repository-derived, not a claim of completeness. Procurement, Finance,
IT, Support, HR, analytics, monitoring, customer support, payment, domain/DNS, email,
workspace, and other SaaS systems must be added from the real vendor ledger even when
they have no code integration.

## 4. AI provider fact matrix

| Question | AWS Bedrock / AgentCore | Typhoon OCR | OpenAI optional path |
|---|---|---|---|
| Payload established by code | **[VERIFIED]** prompts/messages, context/tool results, and images/PDFs where invoked; AgentCore receives serialized request content | **[VERIFIED]** prompt plus full base64 image | **[VERIFIED]** messages, images, and tool calls/results |
| Provider/account currently active in production | **[OBTAIN]** signed task definition, invocation metrics, model/profile, account and region | **[OBTAIN]** live config plus provider account usage | **[OBTAIN]** live config/secret absence and provider account usage; do not infer “unused” from deploy intent |
| Customer data used to train provider/model | **[OBTAIN]** binding terms for exact service/model/account | **[OBTAIN]** binding terms | **[OBTAIN]** binding API/account terms |
| Provider retention and abuse-monitoring window | **[OBTAIN]** | **[OBTAIN]** | **[OBTAIN]** |
| Human review/access | **[OBTAIN]** purposes, personnel, countries, controls, exceptional access | **[OBTAIN]** | **[OBTAIN]** |
| Zero-data-retention/no-store option | **[OBTAIN]** eligibility, approval and live setting; do not infer | **[OBTAIN]** | Request code does not visibly specify `store`; **[OBTAIN]** eligibility, approval, account/project settings, and effective behaviour |
| Deletion/backup/termination | **[OBTAIN]** process, SLA, exceptions, certificate/evidence | **[OBTAIN]** | **[OBTAIN]** |
| Subprocessors/onward model provider | **[OBTAIN]** current list and role chain | **[OBTAIN]** | **[OBTAIN]** |
| Processing/storage/support countries | **[OBTAIN]** exact global-profile and AgentCore path | **[OBTAIN]** provider-enforced region and all other countries | **[OBTAIN]** account/project controls and all other countries |
| Thai sections 28–29 mechanism | **[DECIDE]** after evidence | **[DECIDE]** after evidence | **[DECIDE]** after evidence and before enablement |

`AI_DATA_RETENTION_DAYS` and MangmeePlus purge code govern MangmeePlus-held AI records.
They do not establish any provider's retention, training, abuse-monitoring, or backup
behaviour. Likewise, `TYPHOON_PROCESSING_REGION` and `OPENAI_PROCESSING_REGION` are
internal configuration labels unless provider-side evidence proves enforcement.

## 5. Cross-border assessment record — complete once per material flow

Copy this table for V-01 through V-08 where an overseas transfer or overseas access is
possible.

| Field | Required evidence/decision |
|---|---|
| Flow/register ID and version | **[OBTAIN]** |
| Purpose and necessity | **[DECIDE]**; show why the data/minimum fields are needed |
| Exporter, importer, onward recipients and legal roles | **[OBTAIN]** entities/contracts; **[DECIDE]** roles |
| Data subjects, fields, sensitive/financial/authentication data | **[OBTAIN]** actual data map |
| Transfer method/frequency and remote support/access | **[OBTAIN]** architecture and provider facts |
| Every processing/storage/backup/support/onward country | **[OBTAIN]** dated provider and live account evidence |
| Section 28 adequacy analysis | **[DECIDE]** with source and date, or mark not relied upon |
| Section 29 BCR/appropriate safeguards | **[OBTAIN]** signed/approved instrument and enforceable-rights/remedies analysis; **[DECIDE]** sufficiency |
| Statutory exception, if any | **[DECIDE]** per exact flow; document necessity and why it is not being stretched into a routine mechanism |
| Contract precedence/change notification | **[OBTAIN]** executed order/DPA/transfer terms and version precedence |
| Technical/organizational supplementary controls | **[VERIFIED]** only where tested; otherwise **[OBTAIN]**. Include encryption, key control, minimization, access, logging, incident notice, and deletion. |
| Data-subject notice and tenant authorization | **[DECIDE]** wording/role; **[OBTAIN]** approved copy and customer instruction where relevant |
| Residual risk, approver, conditions, expiry/review | **[DECIDE]** and signed evidence |

## 6. Production evidence manifest

Do not commit contracts containing signatures, account identifiers, or confidential
commercial terms. Store them in restricted company-controlled evidence storage and put
only the durable file ID, document date/version, SHA-256, owner, and access route here.

| Evidence ID | Required artifact | State | Owner |
|---|---|---|---|
| `PROD-INFRA-001` | Signed live AWS/Cloudflare/LINE/Typhoon/OpenAI/GitHub service and account inventory, regions, products, account owners, and last-use dates | **[OBTAIN]** | Platform / IT |
| `PROD-AI-001` | Live AI gateway task definition/config digest, model/provider/profile/region, AgentCore configuration, Typhoon/OpenAI enablement, and invocation summary with no prompt content | **[OBTAIN]** | Platform Security |
| `PROD-RET-001` | RDS backup/PITR, Redis persistence/snapshots, S3 lifecycle/versioning, final-object retention, CloudWatch/logs, queues/caches, exports, and provider retention settings | **[OBTAIN]** | Platform / Privacy |
| `PROD-DEL-001` | End-to-end deletion drill including exact S3 versions, database records/tombstones, queues/caches, restored backups, AI/LINE/vendor propagation, exceptions, and evidence of completion | **[OBTAIN]** | Platform / Privacy |
| `CON-AWS-001` | Executed AWS agreement/DPA/order/service and AI terms, subprocessor list snapshot, transfer terms, security annex, deletion terms | **[OBTAIN]** | Legal / Procurement |
| `CON-LINE-001` | Applicable/executed LINE terms and DPA, subprocessors, countries, retention/deletion/security/breach terms | **[OBTAIN]** | Legal / Product |
| `CON-TYPHOON-001` | Executed Typhoon DPA/order/AI-use and retention terms, subprocessors, countries, security/breach/deletion terms | **[OBTAIN]** | Legal / Procurement |
| `CON-CLOUDFLARE-001` | Executed Cloudflare DPA/order/transfer terms, enabled-product schedule, subprocessors, countries, retention/deletion terms | **[OBTAIN]** | Legal / Platform |
| `CON-OPENAI-001` | If supported: executed OpenAI API agreement/DPA/order, project settings, training/retention/ZDR evidence, subprocessors and transfer terms | **[OBTAIN]** | Legal / AI owner |
| `CON-GITHUB-001` | Applicable GitHub DPA/terms, organization plan/settings, Actions/apps inventory and retention | **[OBTAIN]** | IT / Security |
| `XFER-001..N` | Signed section 28–29 assessment for each material transfer path using section 5 | **[OBTAIN]** / **[DECIDE]** | Privacy / Legal |
| `WEBHOOK-001` | Live tenant webhook endpoint register: tenant, entity/host/country, event fields, instruction, role, retention, transfer mechanism, approval date | **[OBTAIN]** | Product / Privacy |
| `AI-APPROVAL-001` | Actual committee/executive resolution for global AI routing, durable file ID, date/version, SHA-256, signer authority, conditions and review date | **[OBTAIN]** | Company Secretary / Privacy |

Each artifact row must ultimately record: file ID/link, SHA-256, document effective date,
retrieval/export date, scope/account, evidence owner, reviewer, approval date, next review,
and superseded evidence ID.

## 7. Release and change-control gates

1. **No new production recipient or AI provider** until the inventory, contract/DPA,
   data map, countries, subprocessors, retention/deletion, security, incident terms, and
   section 28–29 decision are complete.
2. **No global AI profile approval by reference string alone.** The reference must resolve
   to the signed resolution and vendor/transfer evidence; configuration fail-closed
   controls are technical safeguards, not the legal evidence.
3. **No privacy-notice promise** about training, regional processing, retention, deletion,
   or subprocessors unless the binding/current evidence supports the exact statement.
4. Procurement must notify Privacy/Security before a provider, product, model, region,
   support location, subprocessor, term, or retention setting changes. Re-run the transfer
   assessment and update the public notice/DPA where material.
5. Review this register at least annually and on every trigger above. Preserve the prior
   version and evidence hashes; do not silently overwrite historical decisions.

## 8. External documents and decisions still required

- the executed AWS, LINE, Typhoon, Cloudflare, GitHub, and any enabled OpenAI agreements,
  DPAs/orders, service-specific AI terms, current subprocessor lists, and security annexes;
- provider/account evidence for every storage, processing, backup, telemetry, abuse-review,
  support-access, and onward-transfer country;
- binding AI training/use, retention, human review, deletion, backup, opt-out/no-store,
  and zero-data-retention facts for the exact account, plan, service, and model;
- live production infrastructure, task/model/provider, Cloudflare route/product, LINE
  channel, Typhoon/OpenAI usage, GitHub Actions/apps, RDS/Redis/S3/log retention, and
  deletion-drill exports;
- a signed role allocation and section 28–29 mechanism for each material flow;
- the actual global-routing approval resolution/minutes and signer authority;
- the tenant webhook recipient/instruction register; and
- the non-code vendor ledger from Procurement/Finance/IT/HR/Support so services invisible
  to this repository are not omitted.
