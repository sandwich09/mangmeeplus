# DPO Necessity Assessment Worksheet

Status: **UNRESOLVED — evidence collection and accountable legal decision required**

Assessment date: 2026-08-09

Scope: MangmeePlus / บริษัท มั่งมียั่งยืน จำกัด, as controller for its own account and service data and as a potential processor for tenant-controlled business data

Owner: Privacy / Legal

Technical evidence owner: Platform Security

This worksheet replaces informal DPO conclusions in older engineering notes. It is an
evidence and decision record, not legal advice. A repository fact does not prove the
current production population, a vendor's contractual promise, or a legal conclusion.

## 1. Evidence-state rules

| State | Meaning |
|---|---|
| **[VERIFIED]** | Re-checkable in the named repository file as of the assessment date. This does not prove live production state unless the cited artifact is a signed production export. |
| **[OBTAIN]** | Evidence does not exist in this repository or has not been attached. Obtain the actual document/export; do not replace it with an assumption. |
| **[DECIDE]** | A legal, governance, or risk decision for an accountable person and, where appropriate, Thai privacy counsel. Engineering cannot close it. |

Permitted final outcomes are:

- **DPO REQUIRED**;
- **DPO NOT REQUIRED ON THE RECORDED EVIDENCE**;
- **VOLUNTARILY APPOINT DPO**; or
- **UNRESOLVED**.

The current outcome is **UNRESOLVED**. Do not represent publicly that a DPO has been
appointed, or that one is not required, until section 8 is signed.

## 2. Official legal sources and decision rule

- [Personal Data Protection Act B.E. 2562 (2019), official Parliament copy](https://odl.parliament.go.th/handle/20.500.13072/547319), especially section 41.
- [PDPC Notification on controllers and processors required to designate a DPO under section 41(2), official Parliament record](https://odl.parliament.go.th/handle/20.500.13072/617287) and the [Royal Gazette PDF](https://ratchakitcha.soc.go.th/documents/140D226S0000000001200.pdf).

Section 41 must be assessed separately for the relevant party and processing role. The
three limbs are, in summary:

1. the party is a public authority/body within the prescribed scope;
2. its core activities require regular monitoring of personal data or systems because
   it processes personal data on a large scale within the subordinate rule; or
3. its core activities are processing data under section 26.

The section 41(2) notification does contain a numeric rule: processing involving at
least **100,000 data subjects is deemed large scale**. Below 100,000 is not a safe
harbour. The remaining factors still have to be assessed, including the number or
proportion of people, volume/type/nature of data, duration or permanence, and the
organizational/geographic scope. Industry practice, risk, and effects on data subjects
also matter. The notification also treats certain systematic behavioural-advertising
activity and specified regulated industries as large-scale examples.

Count **people, not database rows, messages, files, or tenants**. A below-threshold
finding must explain the de-duplication method and why unstructured documents and
messages do not make the count materially incomplete.

## 3. Role boundary that must be assessed

| Processing population | Preliminary role evidence | State and required action |
|---|---|---|
| Account holders, administrators, authentication identities, service support contacts, security/audit events, billing relationship | The public legal copy describes MangmeePlus as controller for its own account, security, and support processing. The schema and auth modules store these data. | **[VERIFIED]** technical surfaces exist. **[DECIDE]** approve the legal role map and purposes. |
| Tenant customers, employees, suppliers, counterparties, LINE contacts, CRM conversations, invoices, receipts, statements, and uploaded files processed on tenant instruction | Multi-company data models and tenant-scoped workflows are present throughout `apps/api/prisma/schema.prisma`; the privacy copy describes a controller/processor split. | **[VERIFIED]** technical surfaces exist. **[DECIDE]** approve when MangmeePlus is processor, independent controller, or joint controller for each purpose. Obtain the executed customer DPA/terms. |
| Product analytics, scoring, fraud/security analysis, service improvement, and AI model operations | CRM advisory scoring and AI processing exist; the precise purposes and who determines them are not settled by the schema. | **[DECIDE]** role and lawful basis per purpose. Do not assume tenant instructions cover MangmeePlus's own purposes. |

The DPO test applies to both controllers and processors. Complete the assessment for
MangmeePlus's controller activities and processor activities; do not collapse them into
one unsupported conclusion. Counsel must decide whether the processor-scale assessment
uses all individuals processed across the service, another denominator, or additional
party-specific analysis.

## 4. Section 41 limb worksheet

### 4.1 Public authority/body — section 41(1)

| Question | Evidence | State |
|---|---|---|
| What is the current legal entity and corporate status? | Repository legal content identifies `บริษัท มั่งมียั่งยืน จำกัด` and registration number `0105569135722`. | **[VERIFIED]** repository statement only. **[OBTAIN]** current DBD certificate/company affidavit and verify the registered name, number, status, and address. |
| Is the entity a public authority/body within the prescribed rule? | No authoritative corporate document or signed legal analysis is attached. | **[DECIDE]** after the DBD evidence is obtained. A private-company label in code is not the legal determination. |

### 4.2 Core activity, regular/systematic monitoring, and large scale — section 41(2)

#### Technical indicators of monitoring

| Indicator | Repository evidence | What it does and does not establish |
|---|---|---|
| CRM profiles and channel identities | `CrmCustomer` in `apps/api/prisma/schema.prisma` includes phone, email, LINE/Facebook identifiers, tax ID, addresses, consent, notes, tier, and engagement fields. | **[VERIFIED]** the product can hold identifiable profiles. It does not prove active production population or legal "monitoring" by itself. |
| Scoring/profiling | The same model contains `leadScore`, `sentiment`, `riskLevel`, `tier`, `engagementScore`, `trustScore`, and factor/timestamp fields; CRM code calculates advisory scores and segments. | **[VERIFIED]** profiling-like technical functions exist. **[DECIDE]** whether each purpose is regular/systematic monitoring and whether it is a core activity. |
| Ongoing conversations and attachments | `CrmMessage` stores text, JSON, attachment links, provider identifiers, and delivery history. | **[VERIFIED]** repeated, identifiable interactions can be stored. **[OBTAIN]** production volume, frequency, and active-population evidence. |
| Booking history | `CrmBooking` stores customer, service, staff, time, status, and amounts. | **[VERIFIED]** longitudinal booking activity can be processed. **[DECIDE]** monitoring/core-activity characterization by tenant category and purpose. |
| Campaign/behavioural use | CRM tiers, engagement, consent, segments, and campaign features exist. | **[VERIFIED]** capability exists. **[DECIDE]** whether actual use includes behavioural advertising of the kind covered by the notification. Obtain feature configuration and production-use evidence. |
| AI operations | The AI gateway can send messages, ERP context, images/PDFs, and tool results to configured AI services. | **[VERIFIED]** processing path exists. Model invocation is not automatically "monitoring"; **[DECIDE]** based on purpose, recurrence, and role. |

#### Large-scale evidence table — no estimates may be entered without a source

Complete one row for MangmeePlus controller activity, one for MangmeePlus processor
activity across tenants, and a separate row for any materially different service or
tenant cohort counsel requires.

| Metric | Required value and method | Evidence state |
|---|---|---|
| Assessment period and production build | Exact start/end dates, timezone, environment, deployment revision, extraction timestamp | **[OBTAIN]** signed production export |
| Unique account/administrator data subjects | De-duplicated human count; document treatment of shared accounts and multiple identities | **[OBTAIN]** |
| Unique employees/users processed for tenants | De-duplicated human count across memberships, employee profiles, LINE links, and channel identities | **[OBTAIN]** |
| Unique CRM customers/contacts/counterparties | De-duplicated people across companies and channels; explain legal-entity contacts vs juristic persons | **[OBTAIN]** |
| Individuals visible only in messages/files | Method for estimating or sampling names, faces, account holders, signatures, IDs, or other people not represented by a canonical person row; confidence and limitations | **[OBTAIN]** |
| Total unique data subjects | Reconciliation showing overlap removal and a conservative lower/upper bound | **[OBTAIN]**; compare with 100,000 |
| Data volume, types, and nature | Active/archived profiles; messages; attachments by MIME/type; accounting/tax records; identifiers; financial data; potential section 26 data | **[OBTAIN]** |
| Processing duration/permanence | Earliest live record, active periods, retention rules, legal holds, backups, and post-termination handling | **[OBTAIN]** |
| Organizational/geographic scope | Number of tenants/branches, provinces/countries of data subjects, employee access and vendor/support locations | **[OBTAIN]** |
| Frequency/systematic nature | Daily/monthly active subjects, recurring scans, scoring cadence, campaigns, reminder/reply automation, and monitoring rules | **[OBTAIN]** |
| Risks and effects | DPIA/risk assessment covering financial records, identity fraud, profiling, denial of service/opportunity, confidentiality, and vulnerable groups | **[OBTAIN]** and **[DECIDE]** |

Minimum evidence quality:

- store the query/script revision and its SHA-256;
- record the read-only production role, environment/account, query time, and reviewer;
- export aggregates only to this repository; keep raw personal data in restricted storage;
- have a second reviewer reconcile samples and duplicate handling; and
- state known blind spots. A database count that ignores uploaded files and free text is
  not a complete population assessment.

### 4.3 Core activity processing section 26 data — section 41(3)

| Finding | Evidence | State |
|---|---|---|
| The structured CRM schema does not require a dedicated section 26 field for ordinary retail/trading/service tenants. | Schema inspection as of 2026-08-09. | **[VERIFIED]** limited schema fact only; it is not a finding that section 26 data is absent. |
| Messages, JSON, notes, files, receipts, bank statements, IDs, and images are free-form and can contain sensitive data incidentally or by tenant design. | `CrmMessage.contentText`, `contentJson`, `attachmentId`; customer notes; attachment/OCR paths. | **[VERIFIED]** capability. **[OBTAIN]** production data map and sampling protocol; do not copy sensitive contents into the evidence pack. |
| Health-adjacent categories are supported. New onboarding requires a category and emits a high-severity event for `CLINIC`, `WELLNESS_SPA`, and `MEDICAL_RETAIL`. | `CompanyBusinessCategory` and nullable `Company.businessCategory` in `apps/api/prisma/schema.prisma`; tripwire in `create-company-onboarding.use-case.ts`. | **[VERIFIED]** code path. Existing/historical companies may have `businessCategory = null`; **[OBTAIN]** complete backfill and current tenant-category export. |
| A booking `serviceName`, conversation, or image for a health-adjacent tenant can reveal health information. | `CrmBooking.serviceName` and free-form CRM data. | **[DECIDE]** whether this processing is a core activity and whether section 41(3) is met for MangmeePlus as processor/controller. |
| Biometric, religion, disability, criminal-record, political, union, genetic, sexual-behaviour, or other section 26 content is not ruled out by the product's free-form inputs. | No repository control can prove absence from tenant-supplied text/media. | **[OBTAIN]** data-category mapping, contractual permitted-use controls, tenant cohort review, and DPIA where indicated. |

Do not use “no dedicated database column” or “incidental only” as the final section
41(3) conclusion. Determine the real purpose, scale, recurrence, tenant cohorts, and
whether processing such data is intrinsic to the service offered.

## 5. Preliminary matrix — not a legal conclusion

| Limb | Current result | Why it remains open |
|---|---|---|
| Section 41(1), public authority/body | **[DECIDE]** | Current corporate evidence and legal classification are not attached. |
| Section 41(2), regular/systematic monitoring on a large scale | **[DECIDE]** | Monitoring-capable features are verified, but core-activity analysis and production subject/factor metrics are missing. The ≥100,000 rule has not been measured. |
| Section 41(3), core activity involving section 26 data | **[DECIDE]** | Free-form content and health-adjacent tenant capability are verified; actual cohorts, data map, and core-activity analysis are missing. |
| Voluntary appointment even if no limb is met | **[DECIDE]** | Consider scale growth, tenant trust, financial/identity data, AI, cross-border providers, and independence/cost. |

## 6. Mandatory re-assessment triggers

Re-open this worksheet before or immediately upon any of the following:

- the defensible unique-data-subject count reaches 80,000 (early warning) or 100,000;
- onboarding or discovery of a clinic, wellness/spa, medical retailer, insurer,
  financial institution, telecommunications provider, or another sensitive/regulated
  tenant cohort;
- any historical company remains uncategorized after the agreed remediation date;
- behavioural advertising, automated eligibility/price/credit decisions, location
  tracking, new risk/trust scoring, facial/voice/biometric processing, or systematic
  employee monitoring;
- a new AI/OCR/analytics provider, new data region, global routing, or remote support
  country;
- acquisition, migration, import, or feature launch materially increasing the data
  population, duration, sensitivity, or geography; or
- a legal or PDPC-notification change.

Product and Security must notify Privacy/Legal and attach the change record. “Below
100,000” cannot waive the other factors or the section 41(3) test.

## 7. If a DPO is required or voluntarily appointed

Before publishing a DPO contact, obtain and record:

- appointment letter/resolution, effective date, scope for controller and processor
  activities, and any group/shared-DPO arrangement;
- competence and resources; direct access/reporting to the highest management level;
- independence, no instruction on DPO tasks, protected status, and a documented
  conflict-of-interest assessment for any combined role;
- internal escalation, DPIA consultation, breach, rights-request, vendor-review, and
  regulator-cooperation procedures;
- public contact details that do not expose unnecessary personal information;
- evidence of notice to the Office/other required registration or notification and
  communication to data subjects, where applicable; and
- backup/continuity and annual effectiveness review.

If no DPO is appointed, still name an operational privacy owner and monitored contact
channel. Do not label that person “DPO” unless the appointment and governance conditions
are real.

## 8. Decision and sign-off — must be completed outside engineering

| Field | Required entry |
|---|---|
| Assessment ID/version | **[OBTAIN]** |
| Signed metric evidence IDs/hashes | **[OBTAIN]** |
| Current DBD document ID/hash/date | **[OBTAIN]** |
| Controller/processor role memorandum ID | **[OBTAIN]** |
| Section 41(1) conclusion and reasons | **[DECIDE]** |
| Section 41(2) conclusion and reasons, including 100,000 comparison and all factors | **[DECIDE]** |
| Section 41(3) conclusion and reasons | **[DECIDE]** |
| Final outcome | **[DECIDE]**: DPO REQUIRED / NOT REQUIRED ON EVIDENCE / VOLUNTARILY APPOINT / UNRESOLVED |
| Conditions and remediation | **[DECIDE]** |
| Legal reviewer, role, signature/date | **[OBTAIN]** |
| Accountable executive, role, signature/date | **[OBTAIN]** |
| Next scheduled review date | **[DECIDE]** |

## 9. External evidence still required

1. Current DBD certificate/company affidavit and registered-address confirmation.
2. Signed, reproducible production population/scale export using section 4.2.
3. Current tenant-category export plus completed backfill for nullable historical rows.
4. Data-flow and data-category map covering structured records, free text, attachments,
   OCR, AI context, logs, caches, backups, exports, and support access.
5. Feature-use evidence for scoring, segmentation, campaigns, and automation, not merely
   feature availability.
6. Executed customer terms/DPA and the role-allocation memorandum.
7. DPIA/risk decisions for health-adjacent processing, profiling, AI/OCR, and other
   high-risk cohorts.
8. Thai privacy counsel's signed section 41 analysis and executive decision.
9. If appointed: the DPO governance and notification evidence in section 7.
