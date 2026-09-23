# P1 AI Processor and Lawful-Basis Register

Status: **DRAFT — technical sections complete, legal sections and approval OUTSTANDING**
Technical owner: Platform/AI Security
Approval required before the M-05 top-level checkbox can close.

> **Supersession notice (2026-08-09).** This file contains historical technical and
> approval narrative that has not been revalidated as current production evidence. Use
> [`dpo-necessity-assessment.md`](./dpo-necessity-assessment.md) for the section 41
> assessment and [`processor-cross-border-register.md`](./processor-cross-border-register.md)
> for vendor, AI training/retention, subprocessor, and sections 28–29 evidence. Any claim
> here about a live deployment, vendor role, or approval remains **[OBTAIN]** unless the
> underlying signed/live artifact is filed with a durable ID and hash.

> **How to read this document.** Sections marked **[VERIFIED]** are asserted from the
> code and configuration in this repository and can be re-checked at the cited paths.
> Sections marked **[DECIDE]** are legal determinations that no engineer can make —
> they need the accountable person (and, for anything non-obvious, a lawyer).
> Sections marked **[OBTAIN]** need a document from a vendor that we do not yet hold.
> Nothing in this file is legal advice.
>
> Producing this record is not a formality. Production runs a **global** Bedrock
> inference profile, which AWS may route to any commercial region worldwide. That is a
> cross-border transfer of personal data under PDPA s.28–29, and the deployment is
> fail-closed until §5 below carries a real approval reference.

---

## 1. Processing inventory

| # | Purpose | Data subjects / minimum input | Processor chain | Enforced model/region evidence | Retention / erasure | Lawful basis | Transfer/DPA evidence | Approval |
|---|---|---|---|---|---|---|---|---|
| P1 | Employee LINE business assistant | Employee pseudonymous actor, bounded message preview, permission-scoped ERP results | AWS Bedrock (Anthropic Claude) | `APPROVED_AI_*` at boot **and** per call; tenant `CompanyAiConfiguration`; durable `AiTurn.modelLineageJson` | `AI_DATA_RETENTION_DAYS` (default 90) via the audited PDPA purge sweep | **[DECIDE]** §3.1 | **[OBTAIN]** §4 | **[DECIDE]** §5 |
| P2 | Receipt OCR | Employee actor, receipt image/PDF, company id | Typhoon OCR read → Bedrock understanding model | Both hops stored with purpose/model/region; production requires explicit `TYPHOON_PROCESSING_REGION` | Attachment policy + AI retention; accounting-retention exception | **[DECIDE]** §3.2 | **[OBTAIN]** §4 | **[DECIDE]** §5 |
| P3 | Bank statement OCR | Employee actor, statement image | Typhoon OCR read → Bedrock understanding model | Both hops in `modelLineage`; bounded import provenance | Financial-record retention policy; deletion exception documented | **[DECIDE]** §3.3 | **[OBTAIN]** §4 | **[DECIDE]** §5 |
| P4 | CRM autonomous draft/reply to customers | Customer conversation data, approved template/catalog context | AWS Bedrock (Anthropic Claude) | Gateway/client cost policy + M-03 outbound policy; lineage extension required for any new provider path | CRM message/media retention and erasure workflow | **[DECIDE]** §3.4 | **[OBTAIN]** §4 | **[DECIDE]** §5 |

---

## 2. Technical facts **[VERIFIED]**

### 2.1 Model, provider and region actually enforced

- Production runs **two** `global.` profiles, not one. Both were read from the live task
  definition on 2026-07-28 (`ecs describe-express-gateway-service`, service
  `watchdog-bms-ai-gateway-v2`), not from a branch file:
  - Chat / assistant model (`BEDROCK_MODEL_ID`):
    **`global.anthropic.claude-haiku-4-5-20251001-v1:0`** — this is the model behind P1 and
    P4, the two purposes carrying the *most* personal data (employee turns and customer
    conversations).
  - Document understanding model (`DOCUMENT_AI_MODEL_ID`):
    **`global.anthropic.claude-sonnet-4-6`** — receipt/statement stage 2.
  - Earlier revisions of this register named only the understanding model. An approval that
    lists one of the two would leave the conversational path — the higher-volume,
    higher-personal-data path — transferring across the border with no recorded approval,
    so §5 must name both.
  - **Owner decision 2026-07-28 (recorded by the M-05 deploy lane):** the chat role is
    deliberately upgraded to `global.anthropic.claude-sonnet-4-6`, cost implication
    accepted; `infra/prod-ecs-express/deploy.sh` (`2af5d258`) pins Sonnet 4.6 for BOTH
    roles on the next deploy. The two-model description above stays accurate for the
    *currently running* tasks until that deploy happens. Consequence for §5: an approval
    consumed by the next deploy needs to name Sonnet 4.6 only; an approval issued while
    the Haiku chat task is still live must name both.
- Bedrock account region: **`ap-southeast-1`** (Singapore). The **`global.`** prefix means
  the inference profile is *not* region-pinned: AWS may route an individual request to
  any commercial region. This is the fact that makes §4 necessary.
- Allowlist is enforced twice: at container boot (`validateProductionConfig`) and again
  on every model call (`provider.factory.ts` — `AI_MODEL_NOT_APPROVED` /
  `AI_PROVIDER_NOT_APPROVED` / `AI_REGION_NOT_APPROVED`).
- The safe default allowlist (`DEFAULT_APPROVED_AI_MODEL_IDS`, `packages/config`) contains
  **only** regional APAC profiles, and only ones verified invocable by live probe. Running
  a `global.` profile requires the recorded exception in §5 and fails closed without it.
- **The APAC position in one line, because it is stated in several places below:** a
  regional APAC fallback *does* work and is what the system falls back to, but the newest
  invocable APAC Anthropic profile is two model generations behind the models production
  runs today. §4.1 holds the evidence; everywhere else in this document defers to it.
- OCR first hop: Typhoon OCR, `TYPHOON_PROCESSING_REGION` = `ap-southeast-1`; production
  refuses to boot if the Typhoon key is set without a region.

### 2.2 What personal data actually reaches the model

Worth stating plainly, because it narrows the assessment in §4:

- **Stored on our side** per turn (`AiTurn`): `userMessagePreview`, `messagePreviewHash`
  (SHA-256 hex prefix, 16 chars — the schema comment states *no raw text stored*),
  `replyPreview` (≤120 chars), and provider/model/region/purpose lineage.
- **Stored outside `AiTurn` for LINE recovery/context:** a raw webhook recovery payload can
  exist temporarily until terminal handling (or be parked and cleared after the bounded orphan
  window), and the Redis conversation ledger holds full message text with a one-day TTL. The
  `AiTurn` preview statement therefore must not be presented as “MangmeePlus stores no raw LINE
  text anywhere.” Obtain the live Redis persistence/snapshot and worker-health evidence.
- **Sent to the model** for P1/P4: the message content of the turn plus permission-scoped
  ERP results. For an SME ERP this can include customer names, phone numbers, LINE user
  ids, order and booking details.
- **Sent to the external services** for P2/P3: the receipt or bank-statement image itself —
  which typically carries names, amounts, tax ids, and bank account numbers.
- The repository proves the AWS Bedrock and Typhoon recipient paths, not their legal
  roles. Processor/controller status is **[DECIDE]** from the executed agreement and real
  purpose; the required evidence is tracked in `processor-cross-border-register.md`.

### 2.3 Retention and erasure

- `AI_DATA_RETENTION_DAYS` default **90** (`packages/config`), enforced by the PDPA purge
  sweep in `apps/api/src/modules/crm-inbox/application/use-cases/crm-pdpa.use-case.ts`:
  it purges `AiTurn` and `AiConversation` older than the window
  (`purgeExpiredAiData`), alongside expired CRM message text and media, and writes an
  audit entry `crm.pdpa.purge_sweep` when anything was removed. The sweep is what makes
  the retention period a fact rather than a policy statement.
- The 90-day AI purge does **not** delete final receipt objects below the S3 `evidence/`
  prefix or structured OCR/extraction/verification fields stored with an `ExpenseRecord`.
  Those copies follow the approved expense/accounting schedule and currently require physical
  object-version deletion and purge evidence before any public hard-delete claim.
- Customer erasure runs as a durable case: `CrmDataSubjectRequest`
  (`requestType`, `status`, `dueAt`, `attemptCount`, `resultJson`, `notificationStatus`)
  — so a request has an SLA and an auditable outcome rather than a fire-and-forget delete.
- Retention exceptions apply where accounting/tax law requires the record to be kept;
  those are documented per purpose rather than silently overriding erasure.

---

## 3. Lawful basis **[DECIDE — one row each, do not leave blank]**

Drafted for review. The reasoning below is written out so a lawyer can correct it
quickly; **the decision column is still yours.** Consent is deliberately *not* proposed
as the primary basis for anything the service must do to function — recording consent you
do not act on is worse than not claiming it.

### 3.0 What the code already enforces **[VERIFIED]**

This constrains which bases are honestly available, so read it before choosing.

`CrmConsentStatus` is `UNKNOWN | GRANTED | REVOKED | NOT_REQUIRED`, defaulting to
`UNKNOWN`. It gates **proactive outbound only**:

| Path | Behaviour | Where |
|---|---|---|
| Marketing campaigns | `REVOKED` → `SKIPPED_CONSENT`. With the per-company policy `marketingRequiresExplicitConsent`, anything other than `GRANTED` is skipped (opt-in mode). Inactive/unfollowed identity → `SKIPPED_UNREACHABLE`. | `crm-campaign.logic.ts` `recipientEligibility()` |
| Booking reminders | `REVOKED` → not sent | `scan-crm-booking-reminders.use-case.ts` |
| Retried AI/SYSTEM-authored messages | `REVOKED` → suppressed | `retry-crm-inbox-deliveries.use-case.ts` |
| **Reply to a customer's own inbound message** | **Not consent-gated** | reactive path |

That last row is the important one, and it is coherent: answering someone who just
messaged you is not something you should need marketing consent for. It does mean the
reactive path must stand on a non-consent basis — see 3.4.

### 3.1 Employee LINE business assistant

- **Proposed basis:** s.24(5) legitimate interest of the controller (the employer),
  with s.24(3) contract performance as the alternative where an employment or service
  contract covers use of company systems.
- **Reasoning to review:** the employee is using a work tool to query company data they
  are already permission-scoped to see. The AI adds a natural-language interface; it does
  not widen access. Personal data about the employee is minimal — a pseudonymous actor
  reference, a bounded message preview, and a SHA-256 prefix rather than raw text.
- **Why not consent:** consent between employer and employee is rarely freely given, and
  an employee who refused would simply be unable to use a work tool. That makes consent
  the weaker and less honest basis here.
- **Notice:** employee handbook / internal IT-use policy clause, plus a line in the
  onboarding message when the employee links their LINE account.
- **Objection route:** **[VERIFIED]** self-service toggle at Settings → Security
  (`User.aiAssistantOptOutAt`; `POST /v1/auth/account/ai-assistant`, audited as
  `auth.ai_assistant.preference_update`). An opted-out employee's LINE turn — text and
  media alike — is refused with a deterministic reply *before* any model, tool, or
  gateway involvement (`process-line-webhook.use-case.ts`, event-log status
  `ai_opt_out`). Web app use, including web receipt upload (P2), is unaffected —
  which the notice states.
- **Decision:** **[DECIDE]**

### 3.2 Receipt OCR

- **Proposed basis:** s.24(6) compliance with a legal obligation — accounting and
  Revenue Department record-keeping.
- **Reasoning to review:** the receipt must be captured and retained regardless of the AI;
  OCR only automates transcription of a document the business is already required to keep.
  The retention exception in §2.3 exists for exactly this reason.
- **Care point:** a receipt may carry a *third party's* personal data (a supplier's staff
  name, a customer name on a tax invoice). Those people are not our users and will never
  see our notice, which is a normal situation for accounting records but should be stated.
- **Notice:** privacy notice section on document processing; supplier-facing terms if any.
- **Objection route:** limited by the legal obligation — a person cannot object their way
  out of a statutory accounting record. Say so plainly rather than implying a choice.
- **Decision:** **[DECIDE]**

### 3.3 Bank statement OCR

- **Proposed basis:** s.24(6) legal obligation for the record-keeping itself, with
  s.24(5) legitimate interest for the reconciliation/matching step.
- **Reasoning to review:** statements are financial records; reconciliation is ordinary
  business administration. Bank account numbers and counterparty names are involved, so the
  volume and sensitivity are higher than 3.2 even though neither is s.26 sensitive data.
- **Objection route:** as 3.2 — constrained by financial record-keeping duties.
- **Decision:** **[DECIDE]**

### 3.4 CRM autonomous draft/reply to customers

**Split this row — the two flows are not the same and must not share one basis.**

**(a) Reactive reply to the customer's own inbound message**
- **Proposed basis:** s.24(3) performance of a contract or steps at the data subject's
  request — the customer messaged us about their own booking/order.
- **Reasoning to review:** the customer initiated contact and expects an answer. Requiring
  consent to answer a question someone asked us is not a sensible reading; this matches
  the code, which does not consent-gate the reactive path.
- **Care point:** the customer should still know a machine may compose the reply.

**(b) Proactive marketing campaigns and reminders**
- **Proposed basis:** consent (s.19) for marketing — and the code already implements this
  properly, which makes the basis defensible rather than aspirational:
  - `marketingRequiresExplicitConsent: true` is the **default** in `CONSENT_DEFAULTS`, so
    strict opt-in is the shipped behaviour: anything other than `GRANTED` is skipped.
  - `transactionalMessagesRemainEnabledAfterMarketingOptOut: true` — opting out of
    marketing does not silence booking/service messages, which is the correct split.
  - Unsubscribe keywords already exist: `ยกเลิกข่าวสาร`, `หยุดโปร`, `STOP`, with a
    confirmation reply that states the opt-out does not affect booking/service messages.
  - `deliver-crm-campaign` treats a missing customer record as `REVOKED` — fail-closed.
- **To confirm, not to build:** the policy is overridable per company via
  `CompanyBusinessPolicy`. Check no tenant has set `marketingRequiresExplicitConsent` to
  `false`; if any has, that tenant is on opt-out marketing and the consent basis does not
  hold for it.
- **Notice:** LINE OA first-contact message + linked privacy notice.
- **Objection route:** the unsubscribe keywords above (set `REVOKED`), unfollowing the OA,
  or an erasure request via the `CrmDataSubjectRequest` flow. All three exist in code.
- **Decision:** **[DECIDE]**

### 3.5 Draft notice copy (Thai) — for legal review, not final

**[SUPERSEDED GAP]** A public privacy page now exists in the web app. The copy below is a
historical AI-specific draft and must not replace the current legal artifact. Publication
does not close the vendor-contract, transfer, retention, DPO, or operational evidence
items in the two superseding registers linked at the top of this file.

LINE OA first-contact / greeting addition:

```
เราใช้ระบบอัตโนมัติและ AI ช่วยตอบข้อความและจัดการการจอง/คำสั่งซื้อของคุณ
ข้อความของคุณอาจถูกประมวลผลโดยผู้ให้บริการคลาวด์ของเราซึ่งอาจอยู่นอกประเทศไทย
รายละเอียดและสิทธิของคุณ: <ลิงก์นโยบายความเป็นส่วนตัว>
หากไม่ต้องการรับข่าวสารและโปรโมชัน พิมพ์ "ยกเลิกข่าวสาร" หรือ "STOP" ได้ตลอดเวลา
โดยยังคงได้รับข้อความเกี่ยวกับการจองและบริการที่คุณใช้ตามปกติ
```

> The keywords above must stay identical to `CONSENT_DEFAULTS.unsubscribeKeywords`
> (`ยกเลิกข่าวสาร`, `หยุดโปร`, `STOP`). Publishing a keyword the code does not recognise
> advertises an opt-out route that silently does nothing — worse than publishing none.

Employee onboarding / LINE link message addition:

```
ผู้ช่วย AI จะเห็นเฉพาะข้อมูลที่บัญชีของคุณมีสิทธิ์เข้าถึงอยู่แล้ว
ระบบบันทึกเฉพาะตัวอย่างข้อความแบบย่อและค่าแฮชเพื่อการตรวจสอบ ไม่ได้เก็บข้อความเต็ม
และจะลบอัตโนมัติภายใน 90 วัน
```

Privacy notice must additionally cover: the cross-border transfer in §4, the 90-day AI
retention and its accounting-retention exceptions, the processors named in §1, and how to
exercise access/erasure rights.

### 3.6 If s.24(5) legitimate interest is chosen anywhere

Attach a short balancing note per purpose: our interest, why a less intrusive means does
not achieve it, and why the impact on the person is proportionate. A one-paragraph note
per row is enough — but an unwritten balancing test is not a balancing test.

---

## 4. Cross-border transfer assessment **[OBTAIN + DECIDE]**

This is the section the production deployment is actually gated on.

**The fact to assess:** production uses a `global.` Bedrock inference profile, so a
request containing personal data may be processed outside Thailand — and outside
`ap-southeast-1` — with the destination not known in advance.

Under PDPA s.28–29 a transfer needs one of: an adequate-protection destination, appropriate
safeguards, or a listed exception. To close this section, attach:

- [ ] **AWS Data Processing Addendum** (covers Bedrock) — available from AWS Artifact.
      Confirm it includes Standard Contractual Clauses / equivalent safeguards.
- [ ] **AWS account region + Bedrock service terms** showing what Anthropic models on
      Bedrock do and do not retain. *(Bedrock does not use customer inputs/outputs to
      train models — cite the current AWS service terms clause rather than this sentence.)*
- [ ] **Typhoon OCR processor terms + residency evidence** (P2/P3 first hop).
- [ ] **LINE processor/subprocessor evidence** (P4 delivery path).
- [x] **Written balancing/impact note** — drafted at §4.1. Confirm or correct it; it is
      written from the running configuration, not from intent.

### 4.1 Balancing and impact note **[DRAFTED — review, do not just tick]**

**What crosses the border.** Two categories, and they are not equally sensitive:

| Purpose | What is actually sent | Personal data typically inside |
|---|---|---|
| P1 employee assistant | Turn message content + permission-scoped ERP results | Employee pseudonymous actor ref; customer names, phone numbers, LINE user ids, order/booking details pulled into the answer |
| P4 CRM reply | Customer conversation content + approved template/catalog context | Customer name, contact, conversation history |
| P2 receipt OCR (stage 2) | The receipt/tax-invoice text extracted at stage 1 | Names, addresses, tax ids, amounts — including **third parties** who are not our users |
| P3 statement OCR (stage 2) | Bank-statement content | Account numbers, counterparty names, balances |

**Volume.** Bounded, and the bound is enforced rather than estimated:
`AI_LLM_MAX_PER_COMPANY=60` and `AI_OCR_MAX_PER_COMPANY=20` per
`AI_RATE_LIMIT_WINDOW_SECONDS=60`, per company. This is an SME ERP, not a consumer-scale
service — relevant to the PDPA s.41 "large-scale" question in §5.

**Sensitivity.** No s.26 special-category data is *intended* on any path, and — checked
against `apps/api/prisma/schema.prisma` on 2026-07-28 — **no structured field asks for
any s.26 category**: no health, religion, ethnicity, criminal-record, biometric or
trade-union field exists anywhere in the model. Bank account numbers and tax ids are not
s.26 but carry real financial-fraud impact, so they are the high-water mark of what the
system deliberately collects.

Incidental s.26 data cannot be excluded by the schema, though, and PDPA protection attaches
to the data whether or not it was asked for. Three concrete routes exist:

- `CrmMessage.contentText` is **unbounded free text written by the customer**. Anyone can
  volunteer a medical reason for rescheduling, and it is then stored and sent to the model.
- `CrmMessage.attachmentId` allows customer-supplied images, whose contents are unbounded
  in the same way.
- `CrmBooking.serviceName` is chosen by the **tenant**, not by us. For a general retail or
  trading tenant it reveals nothing; for a clinic, wellness or spa tenant the service name
  alone can be health data. Nothing in the product prevents such a tenant onboarding.

**[DECIDE]** the conclusion, which the facts above frame but do not settle: incidental and
unsolicited s.26 data is *possible on every tenant* and *likely on a health-adjacent
tenant*. That is a different statement from "processing s.26 data is a core activity",
which is what §5's DPO question turns on.

**Safeguards relied on** — each one is checkable, which is the point:

- Prompt/response bodies are not logged: `AI_PROMPT_LOGGING_ENABLED=false`
  (`infra/prod-ecs-express/deploy.sh`).
- Only previews and a hash are stored our side, not raw text (§2.2).
- Model/provider/region allowlist enforced twice — at boot and on every call (§2.1) — so a
  drift to an unapproved model fails closed rather than transferring silently.
- Every call writes durable lineage (`AiTurn.modelLineageJson`), so "which model, which
  region, which purpose" is answerable per record for a data-subject request.
- 90-day retention with an *audited* purge sweep, not a policy statement (§2.3).
- **[OBTAIN]** AWS DPA + Bedrock service terms are the contractual safeguard; until they
  are attached above, this note rests on technical controls alone, which is not sufficient
  for s.28–29 on its own.

**Residual risk that is being accepted, stated plainly.** The `global.` profile means the
destination region is **not known in advance and is not logged per request** — the lineage
records the configured region, not the region AWS actually routed to. So we cannot answer
"which country did this specific message go to". That is the substance of what §5 approves;
it should not be discovered later.

**Alternative that avoids this section entirely, for the record:** pinning production to a
regional APAC profile removes the cross-border transfer. **[VERIFIED 2026-07-28]** — tested
by minimal `bedrock-runtime converse` calls (`maxTokens=1`) in `ap-southeast-1`, because a
profile appearing `ACTIVE` in `list-inference-profiles` does **not** prove the account may
invoke it:

| APAC Anthropic profile | Invocable in this account |
|---|---|
| `apac.anthropic.claude-sonnet-4-20250514-v1:0` | **No** — `ResourceNotFoundException`: *"marked by provider as Legacy and you have not been actively using the model in the last 30 days"* |
| `apac.anthropic.claude-3-5-sonnet-20241022-v2:0` | Yes |
| `apac.anthropic.claude-3-haiku-20240307-v1:0` | Yes |

So the newest *invocable* APAC Anthropic profile really is
`claude-3-5-sonnet-20241022-v2` — two model generations behind the production
understanding model, as originally recorded. APAC Sonnet 4 is listed but closed to new
adoption under Bedrock's legacy-model policy, so it is not an available alternative no
matter what the profile listing suggests.

This strengthens rather than weakens the case for §5: the regional alternative is not a
like-for-like swap, and the receipt-OCR pipeline was tuned and verified on Sonnet 4.6.
Re-test before relying on any of this if more than a quarter has passed — Bedrock's legacy
policy is time-based and this table will rot.

**Not a blocker either way:** the AI task role already permits both
`inference-profile/apac.anthropic.*` and `inference-profile/global.anthropic.*`
(`infra/prod-ecs-express/deploy.sh`), so switching direction later is a config change, not
an IAM change.

The owner decision on 2026-07-28 was to keep the global profiles and record the transfer.
That trade-off is the substance of this assessment; state it here rather than leaving it
implicit.

---

## 5. Approval record **[DECIDE — this is what production consumes]**

`AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` must be set to the **Reference id** below.
The deploy script refuses to deploy production without it, and the gateway refuses to
boot if the flag is set without a reference. Do not invent a value to unblock a deploy —
an approval with no owner is the exact failure this control exists to prevent.

Values below are **drafted, not approved**. Everything still marked **[DECIDE]** needs a
human; the rest is pre-filled from the running configuration so the approver is correcting
a draft rather than starting from a blank page. This table is not an approval until the
approver row and date row are filled in by that person.

> **Status 2026-07-28 — approval in force, one evidence item outstanding.** The decision is
> a committee resolution dated 23 July; the approver, their authority, the reference id and
> the approved model are all settled below, and
> `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF=DPO-2026-07-23-bedrock-global` was set on the
> production environment on 2026-07-28.
>
> **Still outstanding:** the resolution/minutes themselves are not yet filed against this
> record (Linked evidence row) — they are with the company secretary. Until filed, the
> reference the deploy cites resolves only to this file, which is a description of an
> approval rather than the approval.
>
> **This does not block the UAT deploy, and not because anyone waived anything.** UAT has no
> `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` set, so `deploy.sh` takes its regional branch
> and UAT runs `apac.anthropic.claude-3-5-sonnet-20241022-v2:0` — no `global.` profile, no
> cross-border transfer, and no approval consumed. The filing deadline therefore belongs to
> the **production** deploy, which is not scheduled yet, rather than to UAT.
>
> Owner for the filing: company secretary. File on receipt. If the minutes turn out to say
> something other than what §5 records, this record is wrong and must be corrected — not the
> minutes.
>
> Separately, s.41 limb (b) and the controller/processor question are deliberately deferred
> behind the §6 tenant tripwire, not answered.

> **Update 2026-08-09 — the production deploy went ahead before the minutes were filed.**
> The 28 July note above put the filing deadline on "the production deploy, which is not
> scheduled yet". That deploy happened on 2026-08-09: the AgentCore orchestrator runtime was
> redeployed citing `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF=DPO-2026-07-23-bedrock-global`.
>
> **Who decided what.** ธวัชชัย ภูชนะ, as project owner, decided on 2026-08-09 to proceed
> without waiting for the minutes. That is a decision about *deploy timing* and it is his to
> make. It is **not** a second approval of the model use, and it does not stand in for the
> committee: the underlying authority is still the 23 July resolution and nothing about the
> Approver row changes. Recorded this way on purpose, because "the owner said go" and "the
> body approved it" are different facts and only the second one is an approval.
>
> **What is still open — unchanged and now overdue.** The resolution/minutes are still not
> filed against the Linked evidence row. The reference the running production deploy cites
> therefore still resolves only to this file. The 28 July reasoning that the deploy "should
> not be left indefinitely" has now been answered by deploying rather than by filing, so the
> evidence gap is no longer time-boxed by anything. Owner for the filing is unchanged
> (company secretary); it should be closed on receipt.
>
> **Also closed by this deploy:** the Haiku 4.5 window described in the Approved-model(s) row.
> The runtime now pins `global.anthropic.claude-sonnet-4-6` only.

| Field | Value |
|---|---|
| Reference id | **`DPO-2026-07-23-bedrock-global`** — decided 2026-07-28, matching the 23 July resolution date. Set verbatim as `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` in the production environment on 2026-07-28. |
| Scope | Use of `global.` Bedrock inference profiles for purposes P1–P4 above, in AWS account `311414082667`, requests issued from `ap-southeast-1` |
| Approved model(s) | **`global.anthropic.claude-sonnet-4-6` — sole approved model.** Owner decision 2026-07-28: Haiku 4.5 is withdrawn from use rather than sent back for a supplementary resolution, so the approved set matches the 23 July resolution exactly and no second approval is needed. `deploy.sh` (`2af5d258`) already pins both the chat and document roles to Sonnet 4.6, so the next production deploy is what actually removes it.<br>**Residual, stated rather than erased:** withdrawing Haiku 4.5 fixes the position going forward; it does not change the fact that it ran on a global profile on the live task until that deploy. The window is time-boxed and ends at the next production deploy. Two honest consequences: the deploy is now the act that closes this, so it should not be left indefinitely; and the pre-23-July period had no approval of any kind, which is the condition this whole control was introduced to end — not something this resolution back-fills.<br>*Adding another `global.` model later requires a new version of this record, not a silent allowlist edit.* |
| Approver (name, role) | ราฟีดา สมุทร — คณะกรรมการผู้ถือหุ้น. Recorded **as relayed by the engineering lane on 2026-07-28**, not from the approver's own written confirmation, which is still outstanding (see Linked evidence). Until that arrives this row records *who is said to have approved*, which is not the same as an approval.<br>**Confirmed 2026-07-28: the approval is a resolution of that body (มติของคณะกรรมการ)**, not a personal decision, and **ราฟีดา's authority to sign derives from that same resolution** — she signs for the body, not in a personal capacity. The evidence below must therefore be the resolution/minutes, and the minutes are also what evidences the signing authority; one document carries both. |
| Is an appointed DPO required? | **[DECIDE — superseded by `dpo-necessity-assessment.md`]** The 2023 PDPC section 41(2) notification contains a numeric rule: processing involving at least **100,000 data subjects is deemed large scale**. Below 100,000 is not a safe harbour; number/proportion, volume/type/nature, duration/permanence, geography, industry practice, risks, and effects still require assessment. Count people, not tenants, messages, or database rows, and address individuals visible only in free text/files. The public-authority, core-activity, regular/systematic-monitoring, large-scale, section 26, and controller/processor questions all remain unresolved until the signed evidence worksheet is complete. The former unmeasured assumption in this row must not be used as a “DPO not required” finding. |
| Date approved | **2026-07-23** (BE 2569-07-23) — the committee meeting date, confirmed 2026-07-28. This is a real resolution date, not a backdate, so it stands.<br>**Consequence, and it is a real one:** on 23 July this register named only `global.anthropic.claude-sonnet-4-6`. The §2.1 finding that production *also* runs `global.anthropic.claude-haiku-4-5-20251001-v1:0` as the chat model was made on 28 July. The committee cannot have considered a model that was not in front of it, so **this resolution covers Sonnet 4.6 only.** See the Approved-model(s) row for what that leaves open. |
| Version | 1 |
| Conditions | *(proposed)* 1. Applies only to the two models listed above. 2. Requests issued from `ap-southeast-1` only. 3. `AI_PROMPT_LOGGING_ENABLED` stays `false`. 4. Withdraw if AWS Bedrock service terms change on training/retention of customer inputs. 5. Re-assess if an APAC profile of equivalent capability becomes invocable — none is today (§4.1, verified 2026-07-28), so this is a review trigger rather than a live condition. — **[DECIDE]** confirm or amend |
| Expiry / review date | *(proposed)* **2027-07-28**, or earlier on any condition above triggering — **[DECIDE]** |
| Linked evidence | **[OBTAIN] — pending.** (a) the committee resolution/minutes of 2026-07-23, which evidences both the decision and ราฟีดา's authority to sign; (b) the AWS DPA + Bedrock service terms (§4.1 rests on technical controls alone until these are attached).<br>**How to file (a) — a private Google Drive link is fine, and is the right choice:** the minutes carry names and signatures, so publishing them would itself be a PDPA problem inside a PDPA record. Three things make a private link work as audit evidence rather than just a bookmark:<br>1. **Link by file ID** — `https://drive.google.com/file/d/<FILE_ID>/view`. The id survives renames and folder moves; a "share link" can be regenerated or revoked.<br>2. **Record the SHA-256 of the exported PDF in the row below.** This is the one that matters. Drive files stay editable, so a link alone cannot show whether the minutes were altered after filing — while this file is in git, where commits are timestamped and effectively immutable. The hash bridges the two: git proves what the document said on the day it was filed, and anyone can re-hash the Drive copy to check it still matches. `shasum -a 256 <file>.pdf`<br>3. **Own it as the company, then lock it** — file owned by the company Workspace account, not a personal Gmail (an evidence link tied to a personal account dies when that person leaves), set view-only after filing.<br>Also record **who can grant access**, since an auditor reading this needs to know whom to ask.<br>**Do not commit the minutes into this repository** — names and signatures, in a repo shared with engineers; the hash lets this record cite the document without holding a second copy of it.<br>*File id:* **[OBTAIN]** · *SHA-256:* **[OBTAIN]** · *Access via:* **[OBTAIN]** |

**On withdrawal:** clear `AI_GLOBAL_INFERENCE_PROFILE_APPROVED`, drop the
`inference-profile/global.anthropic.*` entry from the AI task IAM policy in
`infra/prod-ecs-express/deploy.sh`, and let production fall back to the regional default.
That fallback does work — both default profiles are verified invocable (§4.1) — but it is
not a costless undo: production lands on `claude-3-5-sonnet-20241022-v2`, two model
generations back, and the receipt-OCR pipeline would need re-verification on it. Withdrawal
is a real option; budget that re-verification when planning it rather than discovering it.

---

## 6. Outstanding before M-05 can close

- [ ] §3 lawful basis decided and written for P1–P4, with notice and objection routes
      (drafted with reasoning — confirm or correct each, do not just tick)
- [x] Privacy notice published at `/privacy` (`apps/web/app/privacy/page.tsx`, public;
      production URL `https://mangmeeplus.com/privacy` after the next web deploy), linked
      from the login page; unsubscribe keywords byte-identical to
      `CONSENT_DEFAULTS.unsubscribeKeywords`. Content is fact-only; legal review of the
      wording rides the §3 decision.
- [x] Employee objection route for P1 — per-employee AI opt-out shipped
      (see §3.1 Objection route; spec `docs/specs/pdpa-notice-and-ai-opt-out-spec.md`)
- [ ] Confirm no tenant has overridden `marketingRequiresExplicitConsent` to `false`
      (strict opt-in is the shipped default; an override breaks the §3.4(b) consent basis)
- [ ] §4 vendor documents obtained (AWS DPA + Bedrock service terms, Typhoon, LINE) —
      the balancing note itself is drafted at §4.1, but it explicitly rests on technical
      controls alone until these are attached
- [x] §4.1 APAC alternative verified by test invocation on 2026-07-28 — APAC Sonnet 4 is
      **not** invocable (Bedrock legacy-model policy); newest invocable APAC profile is
      `claude-3-5-sonnet-20241022-v2`, as originally recorded. Re-test if more than a
      quarter passes.
- [x] **Tenant tripwire — alert the dev team when a qualifying SME onboards.** §5 limb (b)
      and the controller/processor question are deferred on the assumption that today's
      tenant mix is general retail/trading/service. A single health-adjacent tenant
      (clinic, wellness, spa, medical retail) breaks that assumption on its own, because
      `CrmBooking.serviceName` alone then becomes health data and §4.1's "incidental only"
      finding stops holding — so the deferral must not be allowed to expire silently.
      **Built 2026-07-28 via the declared-category route** (spec
      `docs/specs/tenant-business-category-tripwire-spec.md`, plan
      `docs/plans/tenant-business-category-tripwire-plan.md`) — see §6.1 for what was built
      and how it was verified. The `serviceName`/message-text classification fallback was
      **not** used: weaker and more invasive, per the note this item originally carried.
- [ ] **Backfill `businessCategory` for companies onboarded before the tripwire.** The
      tripwire fires at onboarding only, so it says nothing about tenants that already
      exist: every one of them has `businessCategory` null and none was ever checked. That
      matters more than tidiness — §5 accepts the current tenant base "as below the
      threshold **without measuring it**", and this backfill is the measurement. An
      already-onboarded clinic is invisible to everything built above until it is done.
      **Two parts, and the second is the one that bites:**
      (a) decide each existing company's category — a judgement about the customer's
      business, so it needs a human per company and cannot be inferred from the row;
      (b) there is **no way to enter the value today** — `UpdatePartnerProfileUseCase`
      writes only `name`, `brandName`, `timezone`, `locale`, `phone`, `email`, so the
      category is settable at onboarding and nowhere else. Either add it to the partner
      profile edit path or accept a one-off audited SQL backfill. Recording the decision
      matters either way: a category set by direct SQL leaves no audit row, which is
      exactly the provenance gap this register objects to elsewhere.
- [ ] §5 approval record completed (approver + date) and its reference supplied to the
      production deploy as `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF`
- [ ] Receipt OCR re-verified on the production model before relying on it
- [ ] UAT: either mirror production with the same reference, or run the regional profile
      (already handled in `deploy.sh`; UAT AI behaviour is not evidence about production
      when it runs the regional profile)

### 6.1 Tenant tripwire — what was built and how it was verified **[VERIFIED 2026-07-28]**

**Change 2026-09-23:** Owner confirmed the additional PDPA work for health-adjacent tenants is complete and explicitly retired this onboarding alert. The seven-value category and its event are removed by `docs/specs/company-business-type-single-source-spec-th.md`; shop owners now set the current DBD TSIC activity after onboarding. The historical verification below describes the former control, not current behavior. This decision does not by itself establish any separate legal finding recorded elsewhere in this register.

**The gap it closes.** `Company` had no industry/business-type field, so nothing in the
system could tell a clinic from a hardware shop. The deferral in §5 rested on a tenant-mix
assumption that no code could observe, let alone alarm on.

**What now happens.** The system-admin onboarding form asks for a business category
(required, no pre-selected value). It is persisted to `Company.businessCategory` (new
Prisma enum `CompanyBusinessCategory`: `RETAIL`, `TRADING`, `SERVICE`, `CLINIC`,
`WELLNESS_SPA`, `MEDICAL_RETAIL`, `OTHER`) and recorded on the
`system.company_onboarding.create` audit row. When the category is one of the three
health-adjacent values, `create-company-onboarding.use-case.ts` emits
`pdpa.tenant.health_adjacent_onboarded` at `riskLevel: HIGH` **after the transaction
commits**, carrying `companyId`, `businessCategory`, `onboardingRunId`, `actorUserId` and
`requestId` — deliberately no company or owner name, since an alarm path is not a place for
personal data.

**Why that reaches the dev team with no new infrastructure.** The production metric filter
in `infra/prod-ecs-express/deploy.sh` already keys on
`{ ($.riskLevel = "CRITICAL") || ($.riskLevel = "HIGH") || ... }` and routes to
`SECURITY_ALERT_TOPIC_ARN`. So the existing security alarm carries this event: no new SNS
topic, no new alarm, no `deploy.sh` edit, and nothing that depends on AWS provisioning
permissions the platform does not currently hold. The tenant `NotificationRule`/
`NotificationEvent` system was deliberately *not* used — every model in it is tenant-scoped
and its recipients are users inside the tenant, which is the wrong audience for this.

**Verification run 2026-07-28** (worktree `jolly-ritchie-2d34d8`, Node v22.14.0):

| Check | Result |
|---|---|
| `create-company-onboarding.spec.ts` — extended with the tripwire cases | **18/18 pass.** Each of `CLINIC`/`WELLNESS_SPA`/`MEDICAL_RETAIL` emits exactly one event with root-level `riskLevel: HIGH` and the expected fields; each of `RETAIL`/`TRADING`/`SERVICE`/`OTHER` emits none; category asserted on both the company create and the audit `metadataJson` |
| `security-event.spec.ts` + `security-event-emitters.spec.ts` (byte-identity across `apps/api`/`apps/ai-gateway`, alarm-coverage guard) | **23/23 pass** |
| Full `apps/api` suite | **exit 0, zero failures** |
| `tsc --noEmit` — contracts, api | **clean** |
| `tsc --noEmit` — web | one pre-existing error only (`heic2any` declared in `apps/web/package.json` but not installed in this checkout or the main one); touched files clean |

Not run: browser check of the onboarding form, and the live end-to-end path
(onboard a `CLINIC` tenant in a deployed environment → CloudWatch alarm → SNS). Both need a
running environment; the e2e case `SYS-03` was updated to select a category because the form
no longer submits without one.

**Two limits worth stating rather than discovering later.**

1. **The alert only reaches anyone where `SECURITY_ALERT_TOPIC_ARN` is set** — that variable
   is what makes `deploy.sh` install the metric filter and alarm at all. Confirm it is set
   for production before treating this tripwire as live.
2. **An admin who miscategorises a clinic as `OTHER` or `SERVICE` defeats it.** Alerting on
   `OTHER` too was rejected: it would fire on genuinely-other tenants and train the team to
   ignore the alert. The mitigation is that every onboarding's category is on the audit row,
   so uncategorised and `OTHER` tenants can be reviewed periodically; no such sweep is built
   today.
3. **It is forward-only.** Companies onboarded before this change have `businessCategory`
   null and were not backfilled, so nothing here has looked at the tenants that already
   exist — which is the population §5's deferral is actually about. Tracked as its own
   open item in §6; until it closes, "no health-adjacent tenants" remains an assumption
   rather than a checked fact.

**What firing means.** Not a breach and not a blocker — onboarding a clinic is still
allowed. It means a human re-opens §5 limb (b) and the controller/processor question,
because §4.1's "incidental s.26 only" finding no longer holds for that tenant.

---

“Provider configured” is not approval evidence. Neither is this draft.
