# Agent Memory: LINE answer cards Y — 2026-10-19

Status: Code lane complete in about 31 minutes; verification complete with baseline-only environment failures. Native LINE/browser acceptance remains pending. No commit or deployment.
Owner: Codex / owner retest 2026-10-19 18:41–18:43.
Scope: Y1 claim CREATE/UPDATE previews, collection questions and results; expense draft questions/edit/action cards; Y2 credit refusal; Y3 answer-path audit; Y4 reservation/settlement info logs.
Decisions:
- Read AGENTS.md, local ponytail full, Thai UX standard, locked card spec/implementation plan and the two owner screenshots. Reuse the existing locked renderer, receipt facts and postback controls.
- Claim preview is one card with populated facts and its exact revision/digest controls; missing title/reason/purpose are omitted. Multiple claim lines are compact rows. Head Office is localized. The guarded membership lookup prefers the tenant employee display name, with the existing User display name as fallback; UPDATE refreshes legacy requester snapshots before signing and commit checks the same name.
- A preview beyond the existing renderer's row/value/30 KB bounds opens its authorized draft-action web page without a LINE save control. The renderer requires an HTTPS asset base. No rows or confirmation details are silently truncated.
- Expense edit/action cards use the same locked renderer in th/en. Expense collection includes current facts and outstanding questions on the receipt review card. Photo attachment and submit controls retain their authorization checks.
- Credit refusal has one title, one next-step sentence, and one package button for a plan manager. CHAT preserves the existing no-same-month-refill rule and contact action.
- Logs run after transaction commit through the existing Nest logger. No duplicate/rolled-back success logs; logger failure cannot alter the committed result. Settlement includes actual provider cost, all four token counters, overrun, customer charge and absorbed cost. No prompt, user text, signing data or secrets.
- No dependency, package.json, budget contract, final-mutation policy, feature flag or environment switch changed. W00 is regenerated only because its mandatory source-hash check covers the webhook file.
Open questions:
- The reserve contract does not transmit the provider usageTag. Its log records null instead of inventing one; the settled log includes the actual tag and both events carry reservationId. Legacy holds also have no profile/estimator metadata. An optional question was sent; no contract change is authorized.
- Live LINE rendering/asset reachability is not tested. Browser QA at 390/1280 was attempted but Chromium fails at MachPort bootstrap with Permission denied in this sandbox; no screenshots or button measurements are claimed.
- If the tenant has no employee profile, the existing User.displayName remains the only known display name; no personal name is invented.
Artifacts:
- `.live/claim-preview.webp`, `.live/credit-card.webp` viewed; `.live/line-cards-y/payloads.json` contains eight real th/en payloads checked with `lineFlexBodyProblems`.
- `.live/line-cards-y/preview.ts` reproduces the local renderer/browser attempt; `/private/tmp/line-cards-y-browser.log` records the sandbox denial.
- `.live/line-cards-y/verification/` contains full original package argv, node/tsx argv, whole-chain logs and result counts. Baseline extracted from `70ed3ae45` at `/private/tmp/line-cards-y-base-70ed3ae45`.

## Y3 remaining answer paths

Audit scope: System OA API builders, webhook delivery exits, capture notifier and ledger recovery. Tool-result strings that the gateway subsequently renders, unused formatter helpers, and one-sentence notices are not counted as independently delivered dumps. The primary claim/expense draft builders above are fixed; the conditional transport fallbacks below remain explicit.

| Path / condition | Example text | Proposed locked card / constraint |
| --- | --- | --- |
| `line-delivery-plan.logic.ts` — rejected Flex, absent complete-presentation proof, or oversized canonical answer | `ผู้เบิก: …\nยอดรวม: …` | Keep the locked primary; LINE rejection requires the existing text fallback. Control data remains on fallback quick replies. |
| `process-line-webhook.use-case.ts` — `deliverCompletedReplies`, earlier/oversized parts and answers exceeding one reply batch | `เก็บร่างค่าใช้จ่ายแล้วค่ะ\nร้าน: …\nรายการ: …` | Current bounded expense facts/questions use the review card; oversized or multi-batch answers need paginated locked rows or a guarded web handoff. Existing text delivery preserves every part. |
| `line-business-card.logic.ts` — `buildLineBusinessAnswerMessage`, incomplete gateway presentation | Complete model answer plus a multi-line fact list | Typed complete answer layout with rows and named destinations; never discard facts to fit a card. |
| `line-business-card.logic.ts` — assistant/system text-card fallback with missing HTTPS asset base, unsupported link or renderer limits | Multi-line answer and raw web URL | Repair the supplied asset/link data; keep the text fallback when the locked renderer cannot produce a valid payload. |
| `line-draft-update-card.logic.ts`, `line-expense-action-card.logic.ts` — legacy fallback only when locked rendering fails | `วันที่: …\nสถานะ: …\nยอด…` | Normal th/en draft/edit/confirm paths now use locked rows; oversized fields or invalid asset/action data retain the old complete fallback. |
| `line-staff-menu.logic.ts` — `buildCompanyContextMessage`, English | `My shop: …\nSigned in as …` | Company context card with shop/person rows and the existing named navigation. |
| `line-staff-menu.logic.ts` — `buildServiceEntitlementMessage`, English | `Services available for your shop:\n• …` | Locked services list card; retain entitlement filtering. |
| `line-staff-menu.logic.ts` — `buildPendingApprovalCard`, English, no actionable items | `Items awaiting your approval:\nClaims: … pending` | Reuse Thai pending-approval locked rows and read scope. |
| `line-capture-result-notifier.use-case.ts` — split documents, legacy completed read, partial/stale auto-handoff | `อ่านเอกสาร …\nเปิดตรวจรายการ…` | One locked result card per authorized expense, named review buttons; preserve source revision and delivery evidence. Single-document ordinary draft already uses the review card. |
| `drain-line-ledger.use-case.ts` — legacy push and non-v2 Flex-rejection recovery via `toCanonicalTextMessages` | Earlier full answer, or credit refusal notice | Persist/replay the existing v2 locked plan; legacy exact-text integrity and rejected-Flex fallback remain constraints. |
| `line-substitute-receipt-action.service.ts` — source selection and web-only summary | `ผู้รับเงิน: -`, `วันที่จ่าย: -`, document/amount lists | Locked document rows omitting absent facts, with the existing web-only certify/approve link. Not changed: owner explicitly keeps certification/approval/preview on the web. |
| `process-line-webhook.use-case.ts` — `formatGroundedReceiptFollowUp` on fallback/legacy delivery | `ข้อมูลที่อ่านจากหลักฐาน…\nสถานะในระบบตอนนี้…` | Receipt review rows separating printed evidence from current record state. Bound ordinary replies are already prose cards; unbound/oversized/failure exits can send text. |
| `line-preference-command.logic.ts` / `line-file-attempt-answer.logic.ts` / `line-event-discount.logic.ts`, only renderer-fallback delivery | `รูปแบบคำตอบที่จำไว้:\n• …`, `Which file do you mean?\n• …` | Locked preference/file/discount rows. Bound normal delivery already wraps these in a locked prose card; no separate raw-dump primary was found. |

Verification:
- Claim/expense/card/delivery tests, the exact screenshot-message replay, requester-name CREATE/UPDATE checks and the th/en collection question check pass through `node --import tsx`. The full API run includes every new check.
- Full package scripts are executed with their complete file lists, replacing only the forbidden tsx CLI with node/tsx, TAP reporting and concurrency 4. API pretest is included.
- Baseline API socket spec: 16 pass, 2 fail (`listen EPERM`); baseline gateway runtime/minimal-env: 1 pass, 12 fail (`listen EPERM`), 46 cancelled. These match the unchanged environment failures on this worktree.
- Full API: 12,080 pass / 2 baseline socket failures / 199 skip (12,281 tests); pretest 16 pass / 132 skip. Full Gateway: 2,520 pass / 46 baseline runtime cancellations. Full contracts: 487 pass.
- Whole-chain: 5,049 pass / 12 baseline socket failures / 46 baseline runtime cancellations; all four shell suites pass. API reliability 476/476, API behavior 2,422/2,422, Gateway behavior 1,313/1,313, web 8/8, contracts/evaluation 232/232, catalog 4/4, image harness 5/5.
- Importer sweep: all 66 matching API spec files ran, 3,471 pass / 2 baseline socket failures / 135 skip. This includes real-module DI and the table-driven primary/fallback delivery plan. The final typed collection fixture also passes separately.
- `pnpm --filter @watchdog-bms/contracts build`, API typecheck, Gateway typecheck, W00 5/5, eight Flex payload validations and `git diff --check` pass. Exact argv/counts are in `verification/{results,whole-results,importers-results}.json`.
- `.live/line-cards-y/verification/baseline-comparison.json` proves identical failed/cancelled test names, failure reasons and counts on the base and current source. PostgreSQL-dependent tests skip without a database; no PostgreSQL or live provider proof is claimed.
- `.live/line-cards-y/cards-{390,1280}.html` are standalone offline previews with the locked images embedded; they are not browser screenshots. `.live/last-message.md` is the requested handoff (under 40 lines).
Next: Owner reviews the uncommitted diff and retests native LINE/real browser. Reserve usageTag remains explicitly unavailable before settlement under the unchanged budget contract; no live release is implied.
