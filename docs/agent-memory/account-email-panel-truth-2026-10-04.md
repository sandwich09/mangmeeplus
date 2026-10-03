# Agent Memory: account-email-panel-truth-2026-10-04

## Status
Controller revision complete: established LINE app name restored throughout this lane, spelling-only regressions removed, and focused checks, web typecheck, whole web suite and whitespace check passed. All accepted behavior changes remain. Diff is uncommitted; browser execution remains with the controller.

## Owner
Account/profile implementation lane. Controller reviews, commits, and runs browser checks.

## Scope
Refresh the shared account-email panel after the containing page refreshes its account. Correct account/email/password guidance, preserve drafts and existing API security boundaries. No API, contracts, schema, dependency, or package script changes.

## Decisions
- `CompanyProfilePage.load()` re-reads `/v1/auth/account/security` after first-password/contact saves. Pass that existing account object as the panel's refresh dependency, without a second account snapshot, counter, remount, or page reload. Keep the panel's existing OTP read/mutation source and polling; a refresh must not restore navigation state or erase drafts again.
- The standalone `/account/email` caller keeps its own initial read. `AccountSecurityPage` is parked and has no app route (confirmed by app route search and settings-menu tests); leave that component unchanged under the sold-only scope.
- Facts: `AccountProfileUseCase.setInitialPassword` requires a username only if both stored email and username are absent. `PasswordLoginUseCase` accepts stored email even before verification, together with a password. An existing credential uses `/change-password`; that is a separate page, not an inline mutation.
- Facts: account-security `hasPassword` means a credential exists; OTP `hasPassword` means a non-disabled, non-expired credential. Do not overwrite one with the other. Guidance says “จัดการ” rather than promising an unavailable first-password operation.
- Facts: OTP response owns email verification, email-login enabled, active LINE link, revision, challenge and delivery state. Email-login is offered by the panel only when `emailRequirement === READY`; verification alone does not enable it.
- Keep each sentence at one production source; reuse repeated same-email and saved-login messages. Controller correction: use the established name “LINE” on shop pages, as permitted by the sold-features wording rule. The executive-report audience has a separate specification.

### Case → sentence (from the API and rendered form, before code edits)

| Case | Sentence / rendering decision |
| --- | --- |
| All email states, including loading | ยืนยันอีเมลเพื่อใช้กับบัญชีของคุณ · อีเมลรับเอกสารจัดการแยกที่หน้าแพ็กเกจ (no promise of enabled login or first-purchase recipient) |
| No email / saved unverified email / verified email | ยังไม่ได้ผูกอีเมล / ยังไม่ยืนยัน / ยืนยันแล้ว, from the OTP response; loading must not assert no email |
| No usable password and email login off; any username/email/LINE combination | หากต้องการใช้รหัสผ่านเข้าสู่ระบบ จัดการรหัสผ่านสำรองได้ในหน้าบัญชีของฉัน |
| Usable password exists, or email login on | No invitation to set a password in the email panel |
| Verified ready email, email login on / off | เปิดใช้งานอยู่ / ยังไม่เปิดใช้งาน; explanation: เมื่อเลือกเข้าสู่ระบบด้วยรหัสทางอีเมล ให้นำรหัสยืนยันแบบใช้ครั้งเดียว 6 หลักที่ได้รับมากรอกแทนรหัสผ่าน |
| No credential, no email, no username (LINE-only owner included) | Show required username input; keep its existing format hint; password is optional |
| No credential, existing username | Show stored username; do not request a new username |
| No credential, existing email, no username; verified or unverified | หลังตั้งรหัสผ่านแล้ว ใช้อีเมล … คู่กับรหัสผ่านเข้าเว็บได้; no username input |
| Credential exists | ตั้งค่าแล้ว; heading จัดการรหัสผ่านสำรอง; บัญชีนี้มีรหัสผ่านอยู่แล้วค่ะ + เปลี่ยนรหัสผ่าน link; no first-password form |
| No credential, email login enabled | Existing email reauthentication link, then optional first-password form |
| No credential, email login off, LINE linked | ยืนยันตัวตนผ่าน LINE ก่อนตั้งรหัสผ่าน; existing server 5-minute proof still required |
| No credential, email login off, no LINE link | Do not offer a LINE reauthentication link for an unlinked account; no new recovery policy invented |
| LINE reauthentication / LINE in-app browser / return success or failure | Existing conditional actions and proof lifetime, with “LINE” in user text; errors do not claim success |
| Pending OTP | Existing target, attempts, expiry and delivery-specific sentences remain tied to server facts |

## Open questions
None requiring a new product rule. Credential-existence versus usability is a pre-existing API distinction, preserved explicitly.

## Artifacts
- `apps/web/src/features/auth/AccountEmailOtpPanel.tsx`
- `apps/web/src/features/company-profile/CompanyProfilePage.tsx`
- `apps/web/src/features/auth/AccountEmailOtpPanel.state.spec.ts`: component hooks + mocked fetch, six refresh transitions, existing-parent-read wiring, and truthful initial loading.
- `apps/web/src/features/auth/AccountEmailOtpPanel.qa.spec.ts`: existing browser-source guards; restored unchanged from baseline after dropping three spelling-only message tests.
- `apps/web/src/features/company-profile/CompanyProfilePage.qa.spec.ts`: 48 rendered combinations of password, username, email state, email login and LINE link.
- `e2e/account-email-otp-ux.spec.ts`: restored baseline LINE reauthentication expectations; no remaining diff.
- `e2e/profile-completeness-card.spec.ts`: replace obsolete direct-email-save scenario with current backup-password/OTP flow, preserving the email draft and checking no full navigation or reliance on polling.
- `docs/specs/signup-optional-email-otp-billing-spec-th.md`: account state, username rule and truthful guidance.

## Verification
No network, servers, browser, or database available in this lane. Commands below use the existing Node+tsx-loader pattern. No sandbox refusal occurred.

The table below records the first handoff. Its spelling-only red/green row and pre-review counts are historical, superseded by the controller correction recorded afterward; they are not evidence of a retained behavior change.

| Command | Red / intermediate result | Green result |
| --- | --- | --- |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/auth/AccountEmailOtpPanel.state.spec.ts` | Old production: exit 1, 0 pass / 8 fail. Six refresh cases fail with 1 read instead of 2; wiring and initial-loading guards fail. An earlier harness attempt could not replace the API export and got 0 reads; corrected to mock `fetch` before recording the valid red. | Exit 0, 8 pass / 0 fail. An intermediate source guard rejected the arrow inside a prop (7 pass / 1 fail); fixed the guard, not production. |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/company-profile/CompanyProfilePage.qa.spec.ts` | Old production: exit 1, 30 pass / 48 fail (all new matrix cases). After fix: 74 pass / 4 fail exposed stale LINE expectations and broad request-text assertions; finalized login explanation avoids those broad matches. | Included in combined green below: 78 pass / 0 fail. |
| `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/auth/AccountEmailOtpPanel.qa.spec.ts src/features/company-profile/CompanyProfilePage.qa.spec.ts` | Manually put the original LINE wording back for one run, then restored the fix: exit 1, 79 pass / 6 fail. Failing cases: existing in-app-browser copy guard, three return-message checks, passwordless identity button, and step-by-step LINE flow. | Exit 0, 85 pass / 0 fail. |
| `heavy.sh pnpm --filter @watchdog-bms/web typecheck` | No red required for this check. | Exit 0; route types generated and TypeScript completed. |
| `heavy.sh python3 -c 'import os; [os.environ.pop(key) for key in list(os.environ) if key.startswith("S3_")]; os.execvp("pnpm", ["pnpm", "--filter", "@watchdog-bms/web", "exec", "node", "--import", "tsx", "--test", "src/**/*.spec.ts"])'` | All `S3_*` variables removed inside the lock before starting Node; no network/server/browser invoked. | Both runs exited 0, 2,849 pass / 0 fail / 0 skipped, 572 suites. The second run verifies the final sold-only diff and its narrowed wiring guard (confirmed by test name in output). |
| `git diff --check` | No red required. | Exit 0, no whitespace errors. |

- Full-path wrapper: `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh`.
- Old wording search: `rg -n` across `apps/api`, `apps/ai-gateway`, `apps/web`, `e2e/`, filtered to spec/test files. Matches were confined to the touched web specs and the two E2E files; no API/AI spec had an affected sentence. Retained button/substring expectations are still valid.
- Browser checks: **not checked**, prohibited in this lane. E2E red/green is **not checked** for the same reason; controller must run both versions to prove browser regressions if required. Hook/SSR tests do not claim layout/focus coverage.
- API typecheck, PostgreSQL and LINE-AI manifest: not applicable; those areas were not changed.

### Controller correction: established app name

- Restored the original LINE spelling and spacing in all panel reauthentication messages, browser guidance, button, first-password link, corresponding web/E2E expectations, specification and case matrix. The accepted state refresh and truthful guidance remain unchanged.
- Removed the three added reauthentication-message tests: after restoring the name, each sentence is identical to original production, so there is no sentence change for which a red test should be claimed. Existing browser and identity-step tests use their original LINE expectations again. The 48-case matrix permits LINE as a proper name, consistent with the sold-features wording rule.
- Focused command: `pnpm --filter @watchdog-bms/web exec node --import tsx --test src/features/auth/AccountEmailOtpPanel.state.spec.ts src/features/auth/AccountEmailOtpPanel.qa.spec.ts src/features/company-profile/CompanyProfilePage.qa.spec.ts` — exit 0, 90 passed / 0 failed / 0 skipped. No new reauthentication-message red run is claimed: all three spelling-only cases were removed, as authorized by the controller. Prior substantive refresh/copy red evidence remains applicable.
- Leftover-name search: `rg -n` across API, AI gateway, web and E2E spec/test files found only unrelated existing uses (such as online/timeline words and system/LINE-message fixtures); exit 0. The same search over all nine lane files, including the restored baseline spec/E2E files and this note, returned exit 1 with no matches. No unrelated files were edited.
- Required wrapper + `pnpm --filter @watchdog-bms/web typecheck` — exit 0; route generation and TypeScript completed.
- Whole web suite through the same wrapper and exact Python environment-cleaning command in the historical table above, with every `S3_*` variable removed: exit 0, 2,846 passed / 0 failed / 0 skipped, 572 suites. The count decreased by exactly the three removed spelling-only tests.
- `git diff --check`: exit 0, no whitespace errors. The original reauthentication message sentences, four existing panel QA cases and account-email E2E expectations are restored; no sentence-only red/green claim remains for them.

### Controller browser matrix

Run `pnpm exec playwright test e2e/profile-completeness-card.spec.ts e2e/account-email-otp-ux.spec.ts --project=chromium` in the controller environment.

| Page | Account kind / journey | Width |
| --- | --- | --- |
| `/companies/:companyId/settings/profile#account` | LINE-linked, unverified stored email, no username/password; set first password, prompt disappears within 5 seconds, draft retained, current-password field appears, no navigation | 390, 1280 |
| Same | Existing password + verified email; change/confirm email, retry, cancel, delivery/reauth errors; email-login on/off and unsaved section switching | 320, 390, 1280 (OTP flow); 390, 1280 (profile focus) |
| Same | LINE-only owner with no email/username/password; verify required username only until email is stored; returning from LINE preserves email draft | 390, 1280 (manual) |
| `/change-password` → profile account | Existing password: change it, return, confirm fresh panel state | 390, 1280 (manual) |
| `/account/email` | Standalone shared panel, password account and LINE-only account; verify initial loading and reauthentication return | 390, 1280 (manual) |

## Next
Controller: review the diff, run the browser command/matrix above (including E2E red/green where required), then commit. No code work remains pending in this lane.

## Browser check (controller's Claude lane, 2026-10-04, head 2cda540b3 → 8aba1827d)

Local throwaway stack (fresh migrate + seed, web without `S3_*`). Account and OTP answers given to the browser where
LINE re-authentication, e-mail delivery and OTP cannot run locally; the page, panel and password form are real.
- E2E: `profile-completeness-card.spec.ts` first run 4 passed, 2 failed — the merged LINE-owner test typed the draft
  through an exact `getByLabel('อีเมลที่ต้องการยืนยัน')`, which the aria-hidden " *" (14df7093c) defeats; fixed in
  8aba1827d (accessible name). Then 6/6 ×3; `account-email-otp-ux.spec.ts` 7/7 ×3. The merged assertions (heading,
  "…คู่กับรหัสผ่านเข้าเว็บได้", no e-mail command, no navigation, draft kept) pass as written.
- LINE-only owner (no e-mail, username, password), 390 and 1280: "หากต้องการใช้รหัสผ่านเข้าสู่ระบบ จัดการรหัสผ่านสำรองได้ใน
  หน้าบัญชีของฉัน" shows, the username is asked; after "ตั้งรหัสผ่านสำรอง" the sentence is gone within 75 ms, the typed draft
  e-mail stays, the password section reads ตั้งค่าแล้ว; two OTP re-reads, no loop, no sideways scroll.
- Password account changing its e-mail (three steps, code, done) and e-mail login on → off: sentences match each state,
  the old address stays shown until the code is confirmed; no sideways scroll.
- Noticed, not changed: with no e-mail at all the panel shows "ยังไม่ได้ผูกอีเมล" next to the badge "ยังไม่ยืนยัน".
