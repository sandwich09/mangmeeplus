# Receipt result delivery and grounded status

## Problem and outcome

The Drtb incident recorded three drafts but delivered only one result. Two full Thai Flex cards had 400 Unicode code points and 402 UTF-16 units in their preview. The outcome reader rejected them before LINE was called, and recovery parked the stored answers. A later status question reached casual conversation without reading receipt state.

Owners need one readable result per captured receipt and an honest answer when asking about progress. Preserve the full existing card body, PANDA MALA form, draft-first workflow and trial accounting. No new feature flag, schema migration, model/provider change or live record correction.

## Rules and boundaries

- Use the existing conservative 400 UTF-16-unit preview limit consistently; never split a surrogate pair. Preview shortening must not shorten the full card or canonical recovery text.
- Validate messages before recording an outcome. Repair only the known historical preview overflow (at most 400 Unicode code points); reject unrelated malformed payloads. Persist any repaired representation before delivery with the existing CAS/delivery claim and operation key. Recovery never reroutes, rereads images, creates another expense or consumes quota.
- Keep provider-rejected Flex recovery separate from preview repair. Text fallback preserves the full canonical answer when available.
- Link an authorized event to its resolved company before result delivery, so failed outcomes remain visible in tenant investigations.
- Recognize receipt progress questions before generative routing. Look up current expenses using the existing actor, company, chat and branch boundaries. Report only records actually found, with their actual state and a web link. A saved draft is not a confirmed expense or evidence of delivery; never invent a reviewing team or claim every upload finished from a partial result set.
- Context-free or unavailable status must not be presented as success. Do not hijack unrelated workflows or turn status into an unsolicited questionnaire.
- Missing-field metadata must reflect available accepted values. Unknown remains unknown; money reconciliation, tax eligibility and identity review remain independent.

## Acceptance

1. Thai/emoji cards at the incident boundary pass producer and outcome reader and retain all visible details.
2. Recoverable stored previews replay once from the existing outcome; corrupt rows and lost CAS do not send. Already-delivered rows never resend.
3. Multi-receipt progress uses persisted records, avoids AI success assertions, and respects tenant/chat/branch scope. No delivery success is inferred from DRAFT.
4. Complete OCR values do not gain false missing-field warnings merely because optional missingFields was omitted.
5. Focused delivery, recovery, intake and permission regressions pass; TypeScript and required PR checks pass on the reviewed commit.
6. Merge into develop and main only. No UAT/Production deployment, outgoing LINE replay, or live data repair. Previously parked outcomes remain parked until a separately authorized recovery with a verified recipient.

## Impact and limits

The shared preview path protects other LINE cards without changing their theme. Existing idempotency and tenant checks remain authoritative. Receipt identity spelling and incomplete Makro source pages still need source-document review; this fix must not fabricate tax IDs or claim accounting acceptance. The new merged candidate needs its own future UAT/READY evidence; earlier deployment evidence does not validate this change.
