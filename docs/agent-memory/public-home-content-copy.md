# Agent Memory: public-home-content-copy

Status: Item 40 authorized: integrating items 37–39 directly into main/develop. Pre-integration homepage suite passes 26/26; browser visual review remains blocked by tool URL policy, 2026-10-24.
Owner: Codex
Scope: Shared homepage copy and interactions in the existing homepage worktree, branch `codex/homepage-content-copy`. Owner wants sequential revisions, reflected in both default and festival themes, with a running local preview after each item.
Decisions:
- Replace generic assistant references to AI with น้องมั่งมี in the hero, capability strip, how-to steps, correction example, pricing chooser/note/comparison, trust section and FAQ.
- Retain the explicit AI introduction and its image alternative in the รู้จักน้องมั่งมี section. Preserve the AWS Bedrock attribution and human confirmation requirement.
- Update the existing FAQ assertion to the approved wording. No behavior, styling, dependency, other route, SEO metadata or machine-readable wiki change.
- This is an authorized content-baseline revision: default and Halloween share the revised copy. The historical October 21 byte-identical baseline remains evidence of the earlier theme-only implementation, not the expected copy for this revision.
Open questions: None; awaiting the owner's next requested content revision.
Artifacts: `docs/evidence/homepage-copy-2026-10-23/` contains screenshots and the revised shared text baseline in `verification.json`.
Verification:
- `corepack pnpm exec tsx --test src/features/public-home/*.spec.ts` from apps/web: 24/24 pass after updating the existing FAQ wording expectation.
- `next typegen`: pass; no generated-file diff retained.
- Real in-app browser at 390 and 1280: default and Halloween screenshots inspected, no horizontal page overflow, identical shared page text between themes. Additional Halloween widths 360, 768 and 1536 have no horizontal page overflow.
- Browser package chooser with the renamed receipt question recommends เริ่มต้น for ไม่เกิน 30 ใบ; renamed reading-error FAQ opens with its existing answer. Only the introduction retains AI in visible page content. Browser error log empty.
- `git diff --check`: pass. No new automated tests for this copy-only change.
Next: Complete the authorized direct main/develop integration, verify remote refs, and preserve the running local preview.

## Item 2: ask about the shop's existing workload

- Changed the shared package chooser question to `เดือนหนึ่งร้านมีใบเสร็จประมาณกี่ใบ?` so the visitor considers their current receipt volume rather than estimating AI usage. Choices and package-selection logic are unchanged.
- Real browser verification at 390 and 1280: the question is readable with no horizontal page overflow. Selecting 31–50 receipts recommends เติบโต; selecting 51–100 recommends มืออาชีพ.
- Screenshots: `receipt-question-390.png` and `receipt-question-1280.png` in the evidence directory above. The earlier shared text baseline predates this one-line revision.
- `git diff --check`: pass. No additional test file or repeated suite for a label-only change; verified the actual chooser in the browser. Local web remains running on port 43831.

## Local preview

- Web: `http://127.0.0.1:43831/?preview=events&event=default` or `?preview=events&event=halloween&palette=plum`.
- Next dev process session 77549, bound to loopback 43831. Uses existing command with local API base 43832 and AI Gateway base 43833.
- The old local API is not running. Explicit development preview parameters select the theme without it; no backend/database/cloud service was started for this copy review.
- User-facing in-app browser tab 1 remains open. Only the shared homepage source was edited in this worktree; unrelated dirty changes in the original checkout were untouched.

## Item 3: people doing the work and the Enterprise recommendation

- Updated the first chooser question exactly to `ในร้านมีคนช่วยจัดการใบเสร็จและค่าใช้จ่ายกี่คน นับตัวเองด้วย`.
- Owner first requested “มากกว่า 20 สาขา”, clarified this is preview copy only (no real entitlement increase), then replaced it with “มากกว่า 5 สาขา”. Updated the final branch-count answer from `6 - 10 สาขา` to `มากกว่า 5 สาขา`; it selects the existing Enterprise/ธุรกิจ recommendation at 1,999 baht/month.
- Existing catalog and actual package capacity remain 10 branches; package benefit cards/comparison and the contact-team guidance above 10 branches retain the real allowance. The selector label describes the customer's need, not an unlimited package grant.
- Real browser at 390 and 1280: first question wraps legibly, no horizontal overflow. Selecting more than 5 branches recommends ธุรกิจ at 1,999/month; subsequently selecting 1–2 people preserves the higher branch-driven recommendation.
- Screenshots: `people-branches-question-390.png` and `people-branches-question-1280.png`. `git diff --check` passes. Local preview remains running; no backend, entitlement, package-manifest or deployment change.

## Item 4: ask about the shop's current branches

- Changed the shared chooser label to `ตอนนี้ร้านมีกี่สาขา?` exactly as requested. Existing choices and recommendation logic are unchanged in default and Halloween.
- Real browser at 390 and 1280: label present, no horizontal overflow; มากกว่า 5 สาขา recommends ธุรกิจ and 2 สาขา recommends เติบโต. Screenshots: `branch-question-390.png`, `branch-question-1280.png`.
- `git diff --check`: pass. No new tests for this one-line copy change. Local preview remains open on port 43831; no commit/push/merge/deployment.

## Item 5: ask about tax-document work in plain language

- Changed the final shared chooser question to `ตอนนี้ร้านต้องออกเอกสารหัก ณ ที่จ่าย หรือเตรียมแบบภาษีเองไหม?` so visitors do not need to recognize form names. Choices and recommendation logic remain unchanged in both themes.
- Real browser at 390 and 1280: question wraps without horizontal overflow. With other answers unset, ต้องออก recommends ธุรกิจ and ไม่ต้อง recommends เริ่มต้น.
- Inspected screenshots `tax-question-390.png` and `tax-question-1280.png`. `git diff --check` passes; no extra test file/suite for this one-line text change. Local preview remains open; no commit/push/merge/deployment.

## Item 6: matching answer labels and removing duplicate comparison

- Changed the final chooser options to `ไม่ต้องทำเอง` / `ต้องทำเอง`. Preserved the underlying answer indices and plan recommendation logic.
- Removed the entire `เทียบทุกแพ็กเกจ` table in both themes. Retained the four pricing cards, monthly/yearly switch, chooser, notes and the four signup steps. Renamed the remaining component from HomePriceComparison to HomeSignupSteps to reflect its sole content.
- Updated existing rendered-test button selectors and the initial-HTML price assertion: monthly prices render initially; annual amounts remain verified against the catalog/structured offers and by selecting the annual tab.
- Existing homepage suite: 24/24 pass. `git diff --check`: pass. No new tests or dependencies.
- Real browser: default at 390/1280 and Halloween at 390/1280 have no comparison table, four pricing cards and four signup steps, and no horizontal overflow. `ต้องทำเอง` recommends ธุรกิจ; `ไม่ต้องทำเอง` recommends เริ่มต้น when other questions are unset. Annual prices display 2,490 / 4,990 / 9,990 / 19,990; monthly switch restores monthly prices.
- Inspected `simplified-pricing-390.png` and `simplified-pricing-1280.png`; additional evidence in `simplified-pricing-verification.json`. Prior copy-baseline captures predate this authorized removal. Local preview remains open; no commit/push/merge/deployment.

## Item 7: purpose-led chooser heading

- Changed the shared disclosure heading to `หาแพ็กเกจที่เหมาะกับร้านคุณ` and added `ตอบ 4 ข้อจากงานที่ร้านทำอยู่จริง` directly below it. Both remain visible while collapsed, so visitors can understand the chooser before opening it.
- Added only scoped chooser-summary padding and a regular-weight, muted 14px description. Existing disclosure behavior, questions and recommendations are unchanged in both themes.
- Existing rendered homepage suite: 7/7 pass. `git diff --check`: pass.
- Real browser at 390 and 1280: heading/description readable without horizontal overflow; collapsing preserves the description and expanding restores all four questions. Screenshots: `chooser-heading-390.png`, `chooser-heading-1280.png`.
- Local preview remains open; no commit/push/merge/deployment.

## Item 8: consistent recommendation and nearby pricing copy

- Result now says `แพ็กเกจที่เหมาะกับร้านคุณ: [ชื่อแพ็กเกจ]`, matching the chooser heading. The initial prompt says `เลือกคำตอบด้านบน เพื่อหาแพ็กเกจที่เหมาะกับร้านคุณ`.
- Pricing intro now asks visitors to choose by receipt volume, people on the team, branches and the shop's tax-document work.
- Tax-related badges now say `ครบที่สุด ทำเอกสารภาษีได้เอง`, `เหมาะกับงานเอกสารภาษี` or `ไม่ต้องทำเอกสารภาษีเอง` as applicable. Enterprise's audience line says `ร้านที่ทำเอกสารภาษีเอง`. These refer to document work without making visitors identify a form number.
- Contact guidance explicitly names users, receipts per month and branches above existing limits; link text is `ให้ทีมงานช่วยเลือกแพ็กเกจใน LINE`.
- Existing rendered homepage suite: 7/7 pass after updating expected copy. `git diff --check`: pass. No changes to prices, limits, answers, recommendation calculation, endpoints or destination URLs.
- Real browser: initial prompt and no-tax → เริ่มต้น at 390; tax → ธุรกิจ and team size → เติบโต at 1280; no page overflow and the new tax badge fits without truncation. Default/Halloween share the new result and old result wording is absent. Screenshots: `result-copy-390.png`, `result-copy-1280.png`.
- Local preview remains open; no commit/push/merge/deployment.

## Item 9: return to the recommended package after answering

- Once all four chooser questions are answered, focus and scroll to the recommended pricing card. Incomplete answers continue updating the recommendation without moving the visitor away from the questions. Later answer changes scroll to the updated recommendation; clicking an already-selected answer does nothing.
- Use the existing shared HomePricing component, native scrollIntoView and a card ref. Cards have accessible heading labels and programmatic focus; a 104px scroll margin clears the sticky header/badge. Respect reduced motion with instant scrolling. No route change, signup or plan purchase is triggered.
- Extended the existing rendered interaction check: incomplete answers never focus/scroll; completion targets Enterprise with smooth scrolling; changing the tax answer targets Basic with instant scrolling under reduced motion. Focus uses preventScroll so there is only one intended scroll.
- Homepage suite: 24/24 pass. After extending the existing check, rendered suite: 7/7 pass. `git diff --check`: pass.
- Real browser: Halloween at 390px completes at เติบโต with its badge below the header (badge y85, header bottom72). Default at 1280px answers in a different order and completes via Enter at ธุรกิจ (badge y91, header bottom76). No horizontal overflow; three answers keep focus on the question. Re-clicking an answer stays at the chooser, changing the tax answer returns to เริ่มต้น, and switching annual billing keeps focus on the billing toggle.
- Screenshots: `chooser-scroll-390.png`, `chooser-scroll-default-1280.png`, `chooser-scroll-1280.png`. Local preview returned to Halloween with monthly billing. No new dependency, backend change, commit, push, merge or deployment.

## Item 10: inviting signup heading

- Replaced `กดปุ่มแล้วเป็นยังไงต่อ` with the owner's exact wording `ขั้นตอนสมัคร ง่ายนิดเดียว เริ่มกันเลย` in shared HomeSignupSteps, used by default and festival themes. The description and all four signup steps remain unchanged.
- Real local browser at 390 and 1280: new heading visible, four steps retained, no horizontal overflow. Screenshots: `signup-heading-390.png`, `signup-heading-1280.png`.
- `git diff --check`: pass. No new tests or repeated suite for this one-line copy change. Local preview remains open; no commit, push, merge or deployment.

## Item 11: signup description

- Updated the description below the signup heading to the owner's exact wording `เริ่มใช้งานง่าย ๆ ใน 4 ขั้นตอน สมัครได้โดยไม่ต้องใส่บัตร` in shared HomeSignupSteps, applying to both default and festival themes.
- Real local browser at 390 and 1280: description visible without horizontal overflow, all four signup steps retained. Screenshots: `signup-description-390.png`, `signup-description-1280.png`.
- `git diff --check`: pass. No additional tests for this one-line copy change. Local preview remains open; no commit, push, merge or deployment.

## Item 12: review the four signup-step descriptions

- Interpreted “session นี้” as the signup section currently being edited. Preserved the owner's heading, lead and the four existing step titles; clarified each supporting description in shared HomeSignupSteps.
- Step 1 now says `เปิดแชตเพื่อเริ่มสมัครร้านของคุณ`, replacing the vague “เลือกทางสมัครที่เปิดอยู่”. Does not promise one universal button name: existing signup entry points depend on LINE membership and the enabled entry route (current FAQ and LINE-first signup spec §3.1).
- Step 2 now says `บางร้านอาจต้องรอทีมงานตรวจสอบข้อมูลก่อนเปิดร้าน`, making conditional review/waiting clear.
- Step 3 now says `เลือกให้เหมาะกับร้าน แล้วเลือกจ่ายรายเดือนหรือรายปี`.
- Step 4 now says `เมื่อชำระสำเร็จ ส่งใบเสร็จให้น้องมั่งมีใน LINE ได้เลย`, explicitly linking successful payment to starting receipt work, consistent with the existing purchase-without-setup spec and LIFF package-start copy. No signup/payment behavior changes.
- Browser at 390 and 1280: all four descriptions readable, no horizontal overflow. Screenshots: `signup-steps-copy-390.png`, `signup-steps-copy-1280.png`. Default and Halloween use the same updated component.
- `git diff --check`: pass. No new tests for copy-only edits. Local preview remains open; no commit, push, merge or deployment.

## Item 13: expense capability heading

- Changed `จดค่าใช้จ่ายของร้าน` to `บันทึกค่าใช้จ่ายของร้าน` in the shared homepage capabilities section, applying to default and festival themes.
- Real browser at 390 and 1280: heading readable, no horizontal overflow. Screenshots: `expense-heading-390.png`, `expense-heading-1280.png`.
- `git diff --check`: pass. No new tests for this one-line copy change. Local preview remains open; no commit, push, merge or deployment.

## Item 14: prominent data-security message and plain-language AWS explanation

- Changed the existing security panel heading to `ข้อมูลร้านปลอดภัย`, enlarged from 22px desktop / 18px phone to a responsive 30–44px, and increased panel spacing with a subtle border. Shared styles preserve each theme's existing panel colors.
- Replaced the generic intro with the existing controls: encryption in transit, access permissions and important-action history. Replaced the AWS social-proof wording with `AWS คือคลาวด์ของ Amazon` and a plain explanation of Amazon Web Services as computing and storage over the internet, used for the app and receipt files.
- Factual basis: existing homepage source and v3 content ledger lines 97–99 for the app's controls/deployment; AWS's own cloud explainer, https://aws.amazon.com/what-is-cloud-computing/ (checked 2026-10-23), for the general definition. Did not inspect or change live cloud resources. No new certifications, backup/at-rest-encryption claims or absolute safety guarantee added.
- Existing rendered homepage suite: 7/7 pass. `git diff --check`: pass. No new tests for presentation/copy changes.
- Real browser: default and Halloween at 390/1280, measured heading 30px/44px, no horizontal overflow. Inspected screenshots `security-emphasis-390.png`, `security-emphasis-default-1280.png`, `security-emphasis-1280.png`. Other trust content and links retained.
- Local Halloween preview remains open; no commit, push, merge or deployment.

## Item 15: reassuring security copy in everyday language

- Kept the large `ข้อมูลร้านปลอดภัย` heading and rewrote its intro/four supporting points around shop-owner concerns: Amazon hosting, protecting data/passwords, controlling what employees can see/do, and checking assistant-prepared entries before confirmation.
- Simplified AWS to Amazon's service used to run the app and store receipt files. Replaced “HTTPS”, expanded cloud terminology, signed-link expiry and “AWS Bedrock” in this short marketing panel with plain descriptions; retained Amazon attribution for receipt reading. Underlying security behavior and privacy-policy link are unchanged.
- All claims retain the scope of the verified existing copy: encryption in transit, password hashing, access permissions, important-action history and human confirmation. No absolute guarantee or new security capability claimed.
- Real local browser at 390 and 1280: all four updated points present and no horizontal overflow. Screenshots: `security-plain-language-390.png`, `security-plain-language-1280.png`. Shared component applies to default and Halloween.
- `git diff --check`: pass. No new/repeated tests for copy-only changes. Local Halloween preview remains open; no commit, push, merge or deployment.

## Item 16: restore bank-provider reassurance

- Owner wanted the bank comparison restored. Made `ผู้ให้บริการเดียวกับธนาคารชั้นนำ` the first security-card heading and restored that AWS is a cloud provider chosen by leading banks and companies, while retaining the plain explanation of what Mangmee uses it for.
- Comparison is explicitly about the cloud provider; it does not claim Mangmee has the same security controls/certification as a bank. Original wording before the simplification also referred to banks using AWS, not a bank-level certification.
- Verified primary sources on 2026-10-23: https://aws.amazon.com/financial-services/ (HSBC and financial-services customers) and https://aws.amazon.com/solutions/case-studies/capital-one-all-in-on-aws/ (Capital One). No cloud environment access or changes.
- Real local browser at 390 and 1280: restored text readable, no horizontal overflow. Screenshots: `security-bank-provider-390.png`, `security-bank-provider-1280.png`. Shared content applies to both themes.
- `git diff --check`: pass. No new tests for this copy-only change. Local preview remains open; no commit, push, merge or deployment.

## Item 17: emphasize the bank-provider message

- Promoted the AWS/provider item to a full-width leading row in the existing security grid. Heading is now 34px desktop / 26px phone (previously 17px), weight 700, with the existing theme-aware text accent on `ธนาคารชั้นนำ`. The wording and provider-only comparison remain unchanged.
- The three remaining safety points form one row below a divider on desktop, and stack on smaller screens. Mobile places the provider icon above the text to preserve reading width; no new component, dependency or theme override.
- Existing rendered suite: 7/7 pass. `git diff --check`: pass. No new tests for presentation-only changes.
- Real browser: default/Halloween at 390 and 1280, measured heading 26/34px and weight 700, no horizontal page overflow. Inspected `security-bank-emphasis-390.png`, `security-bank-emphasis-default-1280.png`, `security-bank-emphasis-1280.png`.
- Local Halloween preview remains open; no commit, push, merge or deployment.

## Item 18: pop animation for Mangmee's abilities

- Interpreted “anime pop” as a pop entrance animation for the `น้องมั่งมีทำอะไรได้` heading and its five existing capability bullets. Kept the text intact and enlarged the heading to 22px/700.
- Added a small HomeAbilityPop wrapper in existing HomeInteractions. Native IntersectionObserver starts the effect when a quarter of this block is visible, then disconnects; unmount also disconnects. CSS plays a 650ms pop with 80ms stagger between bullets, once per mount. Fine-pointer hover gives each bullet a small lift and light background.
- Content remains visible without JS/IntersectionObserver. Motion rules apply only under prefers-reduced-motion:no-preference; the existing global reduced-motion override also disables animations/transitions. No animation library or dependency added; scope is the shared homepage in both themes.
- Focused existing-pattern test checks out-of-view does not trigger, visible entry does, observer cleanup, and readable fallback. Homepage suite: 25/25 pass. `git diff --check`: pass.
- Real browser: default and Halloween at 390/1280, no horizontal overflow. Captured actual in-flight opacity/scale values and stagger from the default desktop navbar journey in `ability-pop-frame.json`; all six elements return to opacity 1 afterward. Mouse hover reaches the intended translate/scale without hiding content.
- Inspected `ability-pop-390.png`, `ability-pop-default-1280.png`, `ability-pop-1280.png`. Reduced-motion CSS reviewed; browser tooling has no media-emulation capability, so no OS-setting change was made. Local preview remains open; no commit, push, merge or deployment.

## Item 19: research before redesigning the Mangmee explanation

- Owner clarified the goal: reduce the reading burden with animated storytelling, potentially including sound; discuss and research before further implementation. No application code or assets changed in this turn. Item 18 remains the current local prototype, not a validated solution to comprehension.
- Reviewed the current section: five capability bullets, three usage notes and six example questions, plus introduction. Read the existing `docs/research/mangmee-main-website-saas-ux-review-2026-10-20-th.md` for product and research context.
- Desk research checked 2026-10-23: [NN/g online reading](https://www.nngroup.com/articles/how-people-read-online/) supports designing for scanning; [NN/g motion guidance](https://www.nngroup.com/articles/animation-purpose-ux/) recommends meaningful, restrained motion; [NN/g instructional video research](https://www.nngroup.com/articles/instructional-video-guidelines/) supports optional video, short navigable topics, captions and retained text; [Chrome autoplay policy](https://developer.chrome.com/blog/autoplay) and [W3C audio control guidance](https://www.w3.org/WAI/WCAG21/Understanding/audio-control.html) support explicitly user-started audio.
- Proposed for discussion, not approved implementation: a small LINE-style animated demo with the existing mascot, showing receipt submission → prepared draft → human review/confirmation → saved result. Additional selectable stories can show expense questions and pending approvals. Keep a brief visible summary and the full existing details available; preserve permission and confirmation boundaries.
- Suggested sound: optional Thai narration plus restrained action sounds, with captions, mute/pause/replay and reduced-motion fallback. Start with a 15–20 second receipt story as a design hypothesis, not a research-proven duration. Avoid competing motion with festival decorations while a demo is playing.
- Evidence limits: cited research concerns scanning, interaction and instructional comprehension; it does not establish conversion improvements for Mangmee or Thai shop owners. Recommend a small comprehension study with 6–8 intended users before deciding on a broader rollout.
- Verification: source review and current markup inspection only; no tests needed for research-only work. Next: discuss the proposed story and sound treatment with the owner before changing the homepage. No commit, push, merge or deployment.

## Item 20: receipt-story prototype — implementation plan

- Owner approved the first receipt story, pop storytelling by Mangmee, opt-in audio and a local preview. No push or merge.
- Product: help a shop owner understand receipt submission, extracted draft, human review/confirmation and saved result. Use visibly labelled sample data; no real upload, expense mutation or backend call. Preserve existing capability/usage/example copy behind a native details disclosure. Shared homepage only, default and festival themes.
- Implementation: reuse mascot assets and existing theme tokens, a small client component with native HTML audio as the playback clock, four selectable scenes and CSS pop transitions. Generate one local Thai prototype narration track with the installed macOS Kanya voice and brief original tones; use actual clip lengths for scene cues. No dependency or package.json change.
- Acceptance: silent initially; user can start with/without sound, mute, pause/resume, replay and inspect individual scenes; visible captions explain everything without audio. Pause on leaving the section/tab, stop on unmount, expose a usable error state, honour reduced motion. Details remain available without playback.
- Verification planned: focused rendered interaction check covering playback controls, confirmation order and media error; existing homepage suite; real local browser at 390/1280 in default/Halloween, including audio playback, pause/resume/replay and no horizontal overflow.

### Item 20 result and latest owner refinements

- Implemented `HomeReceiptStory.tsx` using existing mascot images, theme-aware CSS and one local narration asset. Four scenes show receipt → extracted draft → human review/confirmation → saved result. The simulation is labelled and makes no backend call or actual expense mutation.
- Moved the previous five ability bullets, three usage notes and six example questions intact into native `ดูความสามารถทั้งหมดของน้องมั่งมี` details. The original AI introduction remains visible. Playback controls sit above the scene so mobile users can start it while seeing the story below.
- Latest owner steering: make the voice youthful/childlike, bright and rhythmic, and remove the arrow. Replaced the initial macOS Kanya track with synthetic `th-TH-PremwadeeNeural`, pitch `+50Hz`, scene rates `+7%, +5%, +0%, +7%`; slower confirmation beat, 480 ms breathing room after each line, original soft pop sounds and a two-note ending. This is a synthetic childlike treatment of a stock voice. Removed the simulated mouse pointer and arrow separators.
- Audio generated with `edge-tts` installed only in temporary `/tmp/mangmee-voice.VRNYzB`; no project dependency or package.json edit, no runtime TTS request. Only the four generic narration lines were sent for synthesis. Primary references checked: https://github.com/rany2/edge-tts and https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts .
- Final static `public/home/mangmee-receipt-story.m4a`: 131,936 bytes, PCM timeline 16.317 s, decoded browser duration 16.439728 s; displayed as 17 seconds. Cue starts: 0, 4.282, 7.538, 11.533. Source and exact narration recorded in `receipt-story-audio.json`.
- Initially stopped/muted with `preload=none`; user can play silently or with sound, mute, pause/resume, restart or select a scene. HTML audio is the clock for captions and scene changes; no competing timer. Stops when leaving the section/tab or unmounting. Failure exposes retry guidance and manual scene selection. Reduced-motion CSS disables movement; no OS media emulation was available, so that setting was code-reviewed rather than toggled in the browser.
- Verification: homepage suite 26/26 passed; focused rendered suite 9/9 passed after final audio cue/pointer changes; `corepack pnpm exec tsc --noEmit --incremental false` passed; `git diff --check` passed. Local page and audio return HTTP 200.
- Browser: default/Halloween at 390 and 1280, no horizontal overflow; three control buttons share 46px height and equal widths (100.664px mobile / 231.555px desktop). Actual media playback verified for silent start, user-started unmuted audio, keyboard and mouse pause, resume, ended counter 17/17, replay from the beginning, and automatic pause offscreen. Retained content count verified after expanding details; browser error log empty. Prototype voice timbre remains for owner listening review.
- Evidence: `receipt-story-plum-1280.png`, `receipt-story-plum-390.png`, `receipt-story-default-1280.png`, `receipt-story-default-390.png`, `receipt-story-browser.json`, `receipt-story-audio.json` under the existing evidence directory. Temporary test tab closed, viewport override reset, original local Halloween tab retained as the deliverable.
- Next: owner reviews `http://127.0.0.1:43831/?preview=events&event=halloween&palette=plum#receipt-story`, especially the voice and pacing. No commit, push, merge or deployment.

## Item 21: additional voice auditions

- Owner still dislikes the prototype voice and requested more options to listen to before choosing. Generated four standalone 5–6 second MP3 samples; did not change the homepage, its current audio, timing or controls.
- A: natural female voice, Premwadee `+0Hz / +2%`; B: softer youthful female treatment, Premwadee `+24Hz / -4%`; C: playful/brisk youthful female treatment, Premwadee `+36Hz / +12%`; D: youthful male treatment, Niwat `+65Hz / +8%`. These are four synthetic treatments of two stock speaker voices, not four different speakers.
- Same short receipt/review script for comparison, with masculine particles for D. No music or pop sounds in these auditions so the voice can be judged independently. Existing temporary edge-tts tool used; no runtime dependency or credentials added.
- Artifacts: `docs/evidence/homepage-copy-2026-10-23/voice-auditions/` contains four MP3 files and `manifest.json` with exact text, voice, pitch, rate, duration and size.
- Verification: all four MP3 files successfully decoded to PCM using afconvert and checked with Python wave (5.66, 6.02, 5.16 and 5.09 seconds); temporary WAVs removed. No application changes, so no repeated app test suite. Local server remains listening on 43831. No push, merge or deployment.
- Next: owner chooses A–D or specifies a preferred tone/pacing combination; then replace the full narration and retime its scenes.

## Item 22: download the owner's reference Reel and extract audio

- Owner supplied `https://www.instagram.com/reel/DezQGLgT9nW/` from `mangmee_plus`, then explicitly requested downloading the clip and extracting its audio as a reference. No new narration or voice clone was requested in this extraction step.
- Opened the public Reel in the in-app browser. Native media download failed for the blob player; page-assets bundling also failed. Used the exact CDN media resources observed by the browser, removing only byte-range parameters to retrieve complete video/audio tracks. Both returned HTTP 200; no login, cookies or third-party downloader site used.
- Saved `docs/evidence/homepage-copy-2026-10-23/voice-reference/reference-reel.mp4` (720 × 1280, about 56.13 s), `reference-audio.m4a` (original HE-AAC stereo mix, about 56.12 s), and `reference-mono-24k.wav` (mono 24 kHz, 16-bit PCM, 56.124 s). MP4 and M4A use stream copy; the WAV is a decoded analysis/reference copy. No denoising, music separation, pitch changes, trimming or normalization. Do not describe this as an isolated vocal or cloned voice.
- `manifest.json` records source attribution, acquisition, transformations, durations, SHA-256 hashes and verification. Installed `imageio-ffmpeg` only into the existing temporary voice-tool environment; no project dependency/package.json changes.
- Verification: all three complete files decode with FFmpeg `-xerror` without error; WAV header/frame count and non-silent PCM levels checked. Existing homepage code/audio/cues are untouched, so no application test suite rerun. No claim to have listened to the voice or assessed its timbre.
- Next: reference audio is ready for the next voice-design decision. Existing synthesis uses stock voices and does not accept a reference clip for direct voice cloning. No upload, commit, push, merge or deployment.

## Item 23: receipt narration audition inspired by the reference

- Owner requested a bright, rhythmic receipt-story voice sample based on the downloaded Reel, to listen to before applying it. Produced standalone audio only; homepage playback and narration remain unchanged.
- Checked available tools and used Plugin Management discovery for voice generation. Results listed unconnected services; none supplied an immediately usable reference-voice tool. Continued with the existing stock Microsoft voice, explicitly described to the owner as a style/prosody treatment, not a cloned speaker.
- Performed a rough local autocorrelation analysis of the reference and prior auditions. Reference mixed-track median estimate was 292.7 Hz versus 266.7 Hz for the previous homepage narration. Music/other sounds confound the low-frequency and silence estimates; this is not a timbre match or a listening assessment. No claim to have listened to the reference. Recorded measurements and limitations in `reference-analysis.json`.
- New script preserves the journey: send a receipt image in LINE → prepare draft fields → review/edit and confirm → saved expense with receipt retained. Split into eight meaning-complete phrases, using Premwadee pitch +55 to +76 Hz and rates -2% to +10%, with 140–360 ms pauses between phrases and a slower confirmation beat. Only generic narration text was sent to TTS; reference audio stayed local.
- Artifacts in `docs/evidence/homepage-copy-2026-10-23/voice-reference-preview/`: `mangmee-receipt-bright-preview.mp3` with four quiet original pop cues and a completion tone; `mangmee-receipt-voice-only.mp3` and `.wav` without effects; `manifest.json` with exact script, per-phrase settings/cues, processing and checks. No background music or original Reel snippets were mixed into the sample. Length 16.058 seconds.
- Verification: both final MP3s decode fully without errors; decoded PCM peak and clipping checks passed; script and confirmation order reviewed. NumPy/SciPy installed only in the temporary audio environment for analysis. No application code/dependency changes or app-suite rerun. `git diff --check` passed.
- Next: owner listens and accepts/refines this audition before any homepage replacement. No commit, push, merge or deployment.

## Item 24: replace the rejected stock-voice approach

- Owner reports item 23 sounds nothing like the reference. Acknowledged that changing stock-voice pitch/rate did not reproduce the voice character; do not treat that audition as accepted.
- Plan: test a real reference-conditioned voice conversion locally using official MyShell OpenVoice V2. Use the supplied reference audio as the target speaker input and the existing Thai narration as source speech; generate a standalone audition and verify the audio files before owner listening review. No homepage replacement.
- Official references reviewed: https://github.com/myshell-ai/OpenVoice , `docs/USAGE.md`, `demo_part3.ipynb`, and https://huggingface.co/myshell-ai/OpenVoiceV2 . The converter supports cross-language inputs; Thai is not in its native TTS list, so retain the existing Thai speech as input and treat output quality as experimental. Both code and model are MIT licensed. Also reviewed ThonburianTTS (Thai reference TTS); did not select its non-commercial model for this business prototype.
- Tools/source/model are being installed/downloaded into temporary `/var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/mangmee-reference-voice-f6qmjmo4/` using a separate Python 3.12 environment. Reference audio stays local. No project package.json or application dependency change.

### Item 24 experimental result

- Installed the temporary tools and official OpenVoice V2 converter checkpoint (131 MB). Code commit `74a1d147b17a8c3092dd5430504bd83ef6c7eb23`. Loaded checkpoint without missing/unexpected keys. CPU inference with four threads; no cloud service or account required.
- Used Demucs `htdemucs` to separate vocals from original Reel seconds 2–22, then extracted the target voice embedding from three consecutive vocal crops. The actual reference audio is an input to this model run. Extracted the source embedding from item 23's Thai narration and converted its four scenes with `tau=0.3`, seed 42. Default OpenVoice/WavMark watermark remains enabled (`@MyShell`). No extra pitch shifting or pop effects.
- Produced `docs/evidence/homepage-copy-2026-10-23/voice-reference-converted/mangmee-receipt-reference-voice.mp3` and `.wav` (16.033 seconds), plus `reference-vocals-20s.wav`, `manifest.json` and `asr-check.json`. This is a reference-conditioned voice conversion audition; timing and delivery still originate from the earlier Thai speech. Do not promise an exact voice match.
- Verification: complete WAV/MP3 decode passes, finite PCM, zero clipped samples, peaks -2.36/-2.76 dBFS. Source homepage narration SHA-256 remains `913ad1ab3893d4d62f3a2643d67079a801e529520f16eb20fb73ac553d543b68`. Internal converter target similarity increased from 0.696 to 0.789, but this is only a model diagnostic, not a human/perceptual similarity score.
- Local Whisper-small sanity check: both source and converted tracks transcribe into four similar story beats with substantial Thai word/spelling errors. This does not certify pronunciation or exact intelligibility. No claim to have listened by ear. Used decoded NumPy audio to avoid a PyAV 19 `metadata_errors` compatibility error; no app dependency change.
- Next: owner compares this actual reference-conditioned audition with the desired voice. Keep the homepage unchanged pending acceptance. `git diff --check` passed; no application suite needed for standalone media. No push, merge or deployment.

## Item 25: target the reference timbre directly

- Owner clarified that item 24's tone is acceptable, but its vocal texture is still wrong. The owner does not know the reference clip's original app or voice name. Do not ask that question again or treat more pitch/rate changes as a timbre solution.
- Plan: generate a short standalone Thai F5-TTS audition directly from a clean reference crop and its transcript. This removes the stock Edge narration from the synthesis input. Keep the homepage and its accepted implementation unchanged until listening acceptance.
- Reviewed primary sources https://huggingface.co/VIZINTZOR/F5-TTS-THAI and https://github.com/VYNCX/F5-TTS-THAI . Model card identifies CC-BY-4.0 weights; preserve attribution in the audition manifest. Installed `f5-tts-th==1.0.9` and downloaded only `model_1000000.pt` / `vocab.txt` into the existing temporary Python environment, not the app or repository dependencies.
- Reference remains local. A six-second vocal crop uses manually corrected Whisper-small transcription; video text confirms the receipt/review context but is not a word-for-word transcript. Similarity and pronunciation remain experimental and require owner listening review.

### Item 25 experimental result

- Generated `voice-reference-f5/mangmee-timbre-audition.mp3` and `.wav` under the existing evidence directory: 6.027 seconds, script `ส่งรูปใบเสร็จมาในไลน์ ให้น้องมั่งมีช่วยอ่านได้เลยค่ะ`. A short opening line isolates the timbre decision before producing and synchronizing a complete story.
- Direct F5-TTS Thai v1 inference uses the reference vocal crop from original Reel 11.8–18.02 seconds and its corrected transcript. Vocos 24 kHz decoder, 32 steps, guidance 2.0, seed 42, fixed combined reference/output duration 12.3 seconds. No Edge speech input, added pitch shift, music or effects. Local Apple MPS float16 initially produced non-finite output; float32 succeeded. Reduced linear gain before PCM encoding to preserve a -3 dBFS peak without clipping.
- Complete WAV and MP3 decodes pass; finite samples and zero clipping, WAV peak -3 dBFS and MP3 -3.44 dBFS. Local Whisper-small recovers the expected short sentence structure with Thai spelling/word errors (including ใบเสร็จ, ไลน์, อ่าน); this does not certify pronunciation or voice similarity. No claim to have listened by ear or matched the speaker exactly.
- `manifest.json` records model attribution/license, source, settings, processing, hashes and verification; `reference-crop-6s.wav` and `asr-check.json` retain the supporting evidence. Model weights and Python tools remain outside the repository. Homepage audio hash unchanged: `913ad1ab3893d4d62f3a2643d67079a801e529520f16eb20fb73ac553d543b68`.
- Next: owner listens specifically for timbre and delivery. Homepage code/audio unchanged; no app-suite rerun for a standalone media audition. No commit, push, merge or deployment.

## Item 26: slightly quicker delivery of the accepted voice

- Owner selected item 25's voice (`เสียงนี้เลย`) and requested a slightly faster, livelier delivery because it still speaks too slowly. Keep that accepted synthetic voice as the basis for subsequent narration.
- Applied local FFmpeg `atempo=1.12` to the exact accepted WAV. This increases tempo by 12% without an intentional pitch change or a new synthesis pass. No music/effects or changes to the words. Preserved the accepted source for comparison.
- Standalone outputs: `voice-reference-f5/mangmee-timbre-brisk.wav`, `.mp3`, and `brisk-manifest.json`, retaining model attribution and source provenance. Full-file decode, finite-sample, duration-ratio and zero-clipping checks pass for both formats. Homepage narration hash remains unchanged.
- Next: owner reviews the quicker sample before the full story is generated and synchronized with the animation. No homepage code/dependency changes or app-suite rerun; no commit, push, merge or deployment.

## Item 27: gently increase pitch rise and fall

- Owner requested a little more high/low variation. Interpreted this as livelier intonation while retaining the selected voice and item 26 tempo, not raising the whole voice uniformly.
- Applied Praat overlap-add processing to the exact item 26 WAV. Expanded its existing pitch contour by 16% in semitones around the median, limiting each pitch change to ±0.7 semitones. No formant scaling, duration change, new TTS generation, music or effects. `praat-parselmouth==0.4.7` was installed only in the temporary audio environment; no project dependency change.
- Primary method references: https://parselmouth.readthedocs.io/en/stable/examples/pitch_manipulation.html and https://www.fon.hum.uva.nl/praat/manual/overlap-add.html . Source attribution remains in `expressive-manifest.json` alongside settings and verification.
- Outputs: `voice-reference-f5/mangmee-timbre-expressive.wav` and `.mp3`, both 5.380 seconds. Complete decode, finite-sample, unchanged-duration and zero-clipping checks pass; MP3 peak -3.49 dBFS. Measured central pitch span increased from 7.48 to 8.74 semitones, confirming the rendered pitch variation; this is not a listening-quality assessment.
- Selected source and homepage narration hashes unchanged. Next: owner listens to this intonation revision. No homepage changes or app-suite rerun; `git diff --check` passed. No commit, push, merge or deployment.

## Item 28: complete the accepted narration and synchronize the prototype

- Owner approved item 27 and explicitly requested a complete receipt story in the local prototype, synchronized with its animation. No push or merge. This is a scoped revision of item 20's existing four-scene implementation.
- Plan: retain the exact accepted opening; synthesize the draft, review/confirm and saved-result lines with the same local Thai F5 reference, 12% quicker tempo and gentle pitch-contour treatment. Match captions to narration and derive scene cues from actual final audio lengths. Preserve the human-confirmation boundary and shared default/festival homepage scope.
- Keep native audio as the animation clock and existing opt-in/mute/pause/replay/scene selection/error/reduced-motion behavior. No backend, package.json, account, cloud or other-route changes. Generate static audio locally and retain model/source attribution in evidence.
- Acceptance: complete narration and captions explain all four steps; scene changes align with their recorded cue times; silence by default and explicit sound control; correct replay/end state. Verify audio decoding/levels and basic transcription, focused homepage tests and real browser at 390/1280 in default/Halloween. Update local preview and task evidence when complete.

### Item 28 result

- Reused the exact approved item 27 opening PCM and synthesized the other three scenes with the same F5 Thai reference and processing: 12% faster tempo and 16% pitch-contour expansion capped at ±0.7 semitones. Local tools only. Kept narration free of background music/effects so the selected voice remains prominent; CSS pop motion is retained.
- Final script: `ส่งรูปใบเสร็จมาในไลน์ ให้น้องมั่งมีช่วยอ่านได้เลยค่ะ` → `ชื่อร้าน วันที่ ยอดเงิน น้องเตรียมรายการให้ค่ะ` → `ถ้าอ่านผิดตรงไหน คุณแก้ได้ ก่อนกดยืนยันนะคะ` → `เรียบร้อยค่ะ เก็บทั้งรายการและใบเสร็จ ไว้ดูย้อนหลังได้เลย`. The review line was simplified after a rough local ASR check failed to recover the initial wording reliably. ASR now recovers the review-before-confirmation sequence, with some Thai spelling errors; it is not a pronunciation certificate or a claim of listening by ear.
- Replaced `apps/web/public/home/mangmee-receipt-story.m4a` (255,769 bytes, SHA-256 `d710a16eeb49eac70a3773c373367941d3bed3c7af801d20fa9d1ed695f798e3`). Container/browser duration 21.4 seconds, displayed as 22 seconds. Updated HomeReceiptStory captions and scene starts to 0, 5.5, 10.29 and 15.25 seconds, within 1 ms of the assembled PCM cues. Native audio remains the sole playback clock. No change to confirmation rules or application APIs.
- Evidence: `voice-receipt-full/` contains four scene WAVs, full WAV/M4A/MP3, source/model attribution, generation settings, level/hash checks and ASR output. Updated `receipt-story-audio.json` to the applied track. Verified the approved opening remains sample-for-sample identical in the full WAV, all output formats decode completely with finite samples/no clipping, and the local HTTP audio bytes exactly match the applied asset.
- Tests: homepage suite 26/26 passed; after the final review-caption revision the rendered suite passed 9/9. TypeScript `tsc --noEmit --incremental false` passed. Existing interaction check now covers each new cue boundary, review before saved result, end counter 22/22, playback controls and error fallback.
- Real browser: default and Halloween/plum at 390/1280, no horizontal overflow or clipped captions. Control buttons remain equal at 46 px high and 100.664/231.555 px wide. Verified initial silent/paused state, muted start, user-started sound, pause/resume, selecting scenes at 5.5/10.29 seconds, complete playback to 21.4 seconds and automatic pause when leaving the section. Screenshots: `receipt-accepted-{default,plum}-{390,1280}.png`; checks in `receipt-accepted-browser.json`. Reduced-motion CSS is unchanged; no OS setting was changed.
- Local server remains running on 127.0.0.1:43831; user preview points to Halloween/plum `#receipt-story`. Scope is the shared homepage narration in default and festival themes. No package.json, backend, other route, cloud or GitHub Actions changes; no commit, push, merge or deployment.

## Item 29: two controls and tighter synchronization

- Owner requests exactly two controls: play/pause and sound on/off, with sound enabled by default. Preserve user-initiated playback (no autoplay). Make steps 1–4 passive progress indicators, remove the separate restart button and scene-seeking actions, and let the play button replay after completion. Sound toggling must never start or restart playback.
- Diagnosis: file joins included roughly 0.5–0.8 seconds of leading silence per phrase and long trailing gaps; scene cues previously used those file boundaries. CSS transitions also used their own elapsed time and `timeupdate` updates could lag the audio.
- Plan: trim excess boundary silence from the approved scene recordings with conservative margins, preserve the actual voice/speech, derive new cues from those final clips, and sample native `audio.currentTime` on animation frames while playing. Drive visual animation progress from that same audio time, including pause/buffering/replay. Update the two-button layout, error copy, existing focused interaction check and memory/evidence; verify default/Halloween at 390/1280 in the running local browser.


## Item 30: play/pause icons

- During item 29 verification, owner requested play/pause icons for the LINE phone demonstration and lower signup demonstration. Replace their shared Reel text button with a compact 44 px round control and inline SVG, retaining changing Thai accessible labels and tooltips. Use the same play/pause symbol on the receipt-story playback control for consistency; keep its separate sound toggle and two-control limit. No new icon dependency or playback behavior change.
- Verify both reel states in the real browser and finish item 29 mobile/default-theme checks before local handoff.

### Items 29–30 result and verification

- Receipt story has exactly two buttons. Play toggles pause/resume and becomes replay at the end; the separate sound toggle defaults to enabled and never starts playback. No autoplay. Four scene markers are passive. Removed the restart/scene-seeking controls and adjusted error guidance.
- Reassembled the accepted four scene recordings after trimming excess boundary silence only. Speech PCM, timbre, pitch and tempo remain unchanged. Final duration 16.82 seconds (17 displayed), scene cues 0, 4.32, 7.54 and 11.72. `voice-receipt-synced/manifest.json` records exact crops, attribution, hash and verification; full WAV/M4A retained beside it. The public asset is 208,995 bytes. WAV matches cropped source samples; AAC fully decodes without clipping. Code cues/duration and local HTTP audio hash match the applied manifest.
- Native `audio.currentTime` now drives both scene changes and CSS animation progress, sampled on animation frames while playing. Pause, buffering, completion, hidden tabs and offscreen sections stop frame updates. Resume uses the actual media position, avoiding backward jumps caused by stale React time. Reduced-motion users retain static imagery/captions.
- Replaced text play/pause on both phone demonstrations with 44×44 px round inline SVG controls and Thai accessible action names/tooltips. The receipt story uses the same play/pause icon; no dependency or package.json changes.
- Automated verification: homepage suite 26/26 passed after synchronization changes; final rendered suite 9/9 passed after icons. TypeScript `tsc --noEmit --incremental false` passed after final edits. `git diff --check` passed.
- Browser: checked default and Halloween/plum at 390×844 and 1280×900, plus native 361 px handoff. No horizontal overflow. Receipt controls equal size: 155×46 px at 390, ~351.33×46 px at 1280, 140.5×46 px at native width. Verified initial paused/unmuted/no autoplay, mute toggling alone, playback, pause with identical audio time/CSS transform across observations, resume at the same time, final scene at 16.82, replay, and automatic offscreen pause. Both phone buttons changed to play when paused and pause when running. Saved `receipt-two-controls-browser.json`, `receipt-two-controls-{default,plum}-{390,1280}.png`, and `reel-icons-{hero,signup}-390.png`.
- A dev-only hydration warning was observed after automation toggled the native preview-tools details before hydration completed (server open vs already-collapsed DOM). It concerns the unchanged preview tools; the final navigation rendered normally. No production preview behavior was changed. OS reduced-motion settings were not changed.
- Local preview remains running on 127.0.0.1:43831 with Halloween/plum selected and narration paused at the beginning, sound enabled. Scope remains homepage only in both themes. No commit, push, merge, deployment, cloud or GitHub Actions operations.

## Item 31: speaker icon

- Replaced the receipt-story sound button text with a 24 px inline speaker SVG, matching the play/pause icon size. Sound on shows sound waves; muted shows a cross. Thai accessible names and tooltips still describe the action (`ปิดเสียง` / `เปิดเสียง`). Existing default sound-on, two-control layout and playback behavior are unchanged.
- Existing rendered homepage checks passed 9/9. Real browser verified sound-on initial state, mute/unmute changes both native audio and icon, and toggling sound leaves playback paused at time 0. Inspected native 361 px layout; screenshot `docs/evidence/homepage-copy-2026-10-23/receipt-speaker-icon.png`.
- Local preview remains open at Halloween/plum receipt story, sound enabled, paused at the start. No dependency, package.json, backend, commit, push, merge or deployment changes.

## Item 32: scroll-triggered mascot introduction

- Owner approved the proposed receipt-section-only prototype: on scrolling into view, mascot pops into reserved inline space and a short speech bubble appears; play starts the accepted narration and synchronized four scenes. Keep two icon controls, sound enabled by default, no autoplay, pause offscreen, no repeated greeting animation when scrolling back. Default and festival themes share this component.
- Smallest implementation: extend the existing visibility observer to reveal the narrator once when half visible; reuse current mascot assets, audio and theme variables. Move playback controls inside the speech bubble. Initial greeting invites the visitor to send a receipt, changing to exact narration captions on play. Existing content stays available, no overlay/fixed mascot or API/backend changes.
- Reserve layout space; progressive enhancement leaves the narrator readable without IntersectionObserver/JavaScript. CSS reduced-motion mode displays everything statically. Verify observer entry/re-entry, early play, no autoplay, offscreen pause, audio cue regression, and actual 390/1280 default/Halloween layouts. No package.json/dependency change.

### Item 32 implementation and verification

- Extended the existing IntersectionObserver to reveal the inline narrator when at least half visible, then unobserve that narrator while continuing section exit/pause tracking. Re-entry does not reset the visible class. Early/keyboard playback also reveals it. Cleanup removes classes/listeners/frames; missing observer leaves the original visible fallback.
- Added a brief 600 ms mascot pop and 350 ms delayed speech-bubble entrance inside the existing reduced-motion media query. Reserved normal layout space using opacity/transforms; no fixed overlay. Kept all narration animation progress on the original audio clock, using a wrapper so the one-time entrance does not replace scene animation.
- Initial greeting: `มีใบเสร็จอยู่ใช่ไหม? ส่งให้น้องช่วยอ่านได้เลยค่ะ`. The two 46×46 px icon controls now sit inside the bubble with a short playback hint. On play, greeting changes to the exact recorded captions. Existing audio file/cues, sound-on default, no autoplay and pause/resume/replay are unchanged. Caption bubble now has a speech tail and mobile narrator remains beside it.
- Automated: `corepack pnpm exec tsx --test src/features/public-home/*.spec.ts` passed 26/26. Existing interaction test now covers threshold entry, unobserving once, returning without replay/autoplay, early play reveal, cleanup and no-observer fallback in addition to all audio-clock/mute/cue/error tests. `corepack pnpm exec tsc --noEmit --incremental false` passed. `git diff --check` passed.
- Browser verification NOT completed: CUA session handles had expired; reacquiring the existing user tab was rejected by browser security policy. Exact reason: `The browser URL policy blocks this action ... The requested URL protocol is not allowed. Allowed protocols: "http:", "https:".` Did not retry through another surface or workaround. No new screenshots or 390/1280 visual claims for this item. Previous item screenshots predate this layout.
- The old dev server was no longer listening, so restarted the same loopback-only Next dev command on port 43831 (session 62379). A HEAD request to the explicit Halloween preview returned HTTP 200. Restored only the incidental generated `next-env.d.ts` path change from starting Next; no unrelated edits reverted.
- Handoff: local prototype ready for owner to refresh and scroll from `#use` to the receipt story. Real-browser review of entrance, bubble layout and both themes remains outstanding due to the tool policy rejection. No commit, push, merge, deployment, package.json, backend or cloud changes.

## Item 33: arrival must happen on scroll without pressing play

- Owner reports that the promised scroll pop still appears to require a click. Keep the approved boundary: scroll reveals mascot + greeting, play starts audio/narration only.
- Code/layout diagnosis: item 32 observes the entire narrator at 50%; on desktop that block starts with the speech bubble and places the mascot below it. The threshold can fire before the actual mascot enters the viewport, using up the one-time entrance offscreen. The image is lazy-loaded, so its entrance can also finish before image pixels arrive. Play currently adds the reveal class, masking a missed scroll trigger.
- Plan: observe the actual mascot wrapper instead, inset the trigger viewport to avoid sticky header/bottom CTA, wait for the image to load before revealing, and remove reveal mutation from play. Keep the once-per-mount entrance and existing pause/mute/audio-clock behavior. Add a regression for bubble visible while mascot remains offscreen, image loading, no-click reveal and no replay on returning. Browser verification remains constrained by the prior explicit URL-policy rejection; do not circumvent it.

### Item 33 result

- Observe `.receipt-character-reveal` at 35% visibility instead of the whole narrator at 50%. Insets of 96 px at the top and 88 px at the bottom avoid triggering under the sticky header/bottom CTA. The whole narrator was capable of consuming its entrance before the mascot below the bubble reached the viewport; this is a code/layout diagnosis, not a reproduced browser observation.
- Eager-load the small (~26 KB) mascot asset and wait for load/error readiness while it is in the trigger viewport. An image finishing offscreen waits until re-entry; cached images reveal immediately on entry. Keep the mascot/image DOM node stable between narration scenes so the listener remains valid. Unobserve after introduction and remove listeners on cleanup.
- Removed the reveal-class mutation from `play()`. Scroll/image readiness own entrance; play owns narration. Initial helper now says `กด ▶ เมื่อต้องการฟังเสียง` to clarify the control. No audio source/cue/default mute-state changes.
- Expanded the existing regression to cover: bubble visible while mascot is offscreen; partial mascot visibility; loading finishing offscreen; scroll reveal without any `play()` call; cached image; image failure; no repeated introduction and cleanup. Final rendered suite passed 9/9; `tsc --noEmit --incremental false` and `git diff --check` passed. Local preview HEAD returns HTTP 200 on port 43831.
- Real-browser review is still NOT performed because the earlier URL-policy rejection forbids retrying through alternative browser surfaces/workarounds. No new screenshot or visual-pass claim. Owner can open `#top`, refresh once, then scroll to the receipt section to see a fresh once-per-mount entrance. No commit, push, merge, deployment, package.json, backend or cloud changes.

## Item 34: automatic narration on scroll and one larger opening pop

- Owner explicitly clarifies that entering the section must start the approved narration WITH sound and synchronized scenes, without pressing play. Preserve pause/resume and mute controls. Pop only once at the beginning, visibly enlarge the mascot, then settle slowly; remove per-scene pops. This supersedes the earlier no-autoplay interpretation.
- Plan: reuse the mascot/image visibility observer to attempt native audio.play once, respecting the current mute choice. Begin the opening animation on actual playback, retain its class across scenes/replay, and reserve the maximum mascot footprint. Keep native audio time for all scene cues and gentle movement; pause offscreen/hidden and honor reduced motion. No new dependency, API, route, backend or audio generation.
- If native play rejects with NotAllowedError, show a short explanation beside the existing play control; do not loop/retry or bypass browser autoplay policy. Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play . Scroll cannot guarantee audible autoplay on all browsers.
- Verify autoplay without click, exactly one attempt on repeated entry, blocked-autoplay fallback/manual retry, current mute state, image readiness, pause/resume and existing cue boundaries. Run focused tests, TypeScript and local availability check. Browser visual/autoplay QA remains blocked by the prior explicit URL-policy rejection; no alternate surface or workaround.

### Item 34 result and verification

- First eligible mascot entry with image readiness now calls the existing native playback path once. Sound remains enabled by default; a prior mute choice is respected through the media element's current mute state. The observer does not restart playback after pause, return from offscreen, or an early manual start/pause. Hidden/offscreen playback pauses, including pending audio loads.
- The narrator becomes visible at entry, while the mascot's opening animation starts on the first actual `playing` event. Its persistent `has-started` class and stable DOM prevent replays at scene changes, buffering/resume or replay. It grows to 1.33× normal size and settles over 1.8 seconds. Reserved maximum footprint avoids introducing an overlay; mobile width scales from 90–120 px. Opening animation pauses with playback/loading; gentle image movement and all four scene changes still follow native audio time. Reduced-motion rules retain static content.
- Removed per-scene pop keyframes/selectors and their unused scene-time property. Kept both icon controls, source audio, script, cue times, scene content and both homepage themes unchanged. No backend or other-route effect.
- A rejected `NotAllowedError` shows `เบราว์เซอร์ยังไม่ให้เปิดเสียงอัตโนมัติ แตะ ▶ เพื่อฟังน้องนะคะ` next to the existing control. It does not claim playback began, loop attempts, silently mute, or bypass browser policy. Manual retry clears the hint. Other errors retain the existing retry message; cancellation on pause is not presented as failure.
- Verification: `corepack pnpm exec tsx --test src/features/public-home/PublicHome.rendered.spec.ts` passed 9/9. Regression covers no-click audible start, current mute choice before entry, image load/error, repeated scroll without replay, blocked autoplay/manual recovery, cancellation while loading, early manual pause, scene cue boundaries, buffering, end/replay, hidden/offscreen pause and cleanup. An initial TypeScript failure from test-array narrowing was fixed; final `corepack pnpm exec tsc --noEmit --incremental false` passes. `git diff --check` passes.
- Existing local server responds HTTP 200 on 127.0.0.1:43831 for the Halloween/plum preview; no generated next-env.d.ts diff. No browser visual/autoplay verification or new screenshot: automatic approval review previously rejected observing the local tab under its URL policy, and no workaround was attempted. Owner should refresh and scroll from the top for a fresh entrance; audible autoplay depends on that browser's policy.
- No commit, push, merge, deployment, package.json/dependency, audio asset, cloud or GitHub Actions operations. Next: owner reviews the local entrance timing, sizing and playback in their browser.

## Item 35: muted by default and plain Thai playback hints

- Owner requests sound OFF by default and understandable copy without the word เบราว์เซอร์. Preserve scroll autoplay, synchronized scenes, the single opening pop and both existing icon controls.
- Plan: change the existing sound state default; show `เปิดเสียงเพื่อฟังน้องมั่งมีเล่าได้นะคะ` while muted playback runs. If playback is blocked, show `แตะ ▶ เพื่อเริ่มเรื่องได้เลยค่ะ`, which describes the action without promising sound while muted. Verify initial muted autoplay, explicit sound toggling and blocked playback recovery in the existing focused test.

### Item 35 result

- Applied the muted default and both plain-language hints. Native audio receives `muted=true` initially; the speaker icon starts with its muted symbol/action `เปิดเสียง`. Scroll still starts the same timeline; enabling sound continues from its current position without restarting the story. Opening pop and the two controls remain unchanged in both homepage themes.
- Updated the existing test's media stub to reflect the declarative muted prop and verified muted scroll start, enabling sound, a sound choice before entry, pause/resume, blocked playback guidance without technical wording, manual retry and existing cue boundaries. `corepack pnpm exec tsx --test src/features/public-home/PublicHome.rendered.spec.ts`: 9/9 passed. `git diff --check` passed; local preview HEAD returned HTTP 200. No additional broad suite needed for this default/copy change.
- Actual tab visual/playback QA remains unverified because the earlier automatic approval review rejected local browser observation under the URL policy. No retry/workaround. No commit, push, merge, deployment, dependency, audio, backend or CSS changes for this item.

## Item 36: direct integration into main and develop

- Owner explicitly authorizes merging the accumulated homepage changes into both branches now, with no PR. This supersedes earlier no-push/no-merge instructions. Existing instruction not to wait for GitHub Actions remains in force; this is source integration, not a deployment request.
- Refreshed origin/main and origin/develop. The branches have distinct histories (324 main-only and 1,770 develop-only commits), but the public-home implementation and its relevant contracts agree. Apply only this reviewed homepage changeset to each current remote branch, preserving their independent histories and unrelated changes. Use a temporary integration checkout so the active local preview and other working directories stay intact. Push fast-forward updates without force, preferably atomically for both refs.
- Commit the homepage code, approved final narration asset, task memory, top-level screenshots/verification records and final audio provenance manifests. Keep the downloaded reference, extracted voice, intermediate audio and auditions local; they are not runtime dependencies. Screenshots predate items 32–35 and must not be presented as verification of their revised layout. Earlier media paths in this memory describe retained local artifacts.
- Pre-integration checks: full homepage suite 26/26 passed; TypeScript `tsc --noEmit --incremental false` passed; `git diff --check` passed. Latest UI browser review remains blocked by the previously recorded automatic URL-policy rejection; owner has reviewed the running local prototype and now authorized integration. No claim of deployment or live customer acceptance.

### Item 36 completion (local handoff record)

- Source changeset: `5e52108313c682df51b16e8b4fa2634015b9b8e0`. Applied without conflicts to each independent remote baseline; only the scoped homepage files, final audio, evidence and memory changed (78 paths). No package.json, backend, entitlement or deployment changes.
- `origin/main`: `8d7cdca01be51ab51780b8c80d0d9185ca4de950` → `789547f9b7ca09c3412d884c94a5bdc0a7d001ac`.
- `origin/develop`: `478b84f107820e039be8a013f143f54f03b461b5` → `e879d556156a4c4b5da32b9664587e091a39ea59`.
- Homepage tests pass 26/26 on each prepared target branch; compared all public-home code and the final narration asset across the two branches with no differences. `git push --atomic` successfully advanced both refs without force. `git ls-remote --heads origin main develop` confirms the exact accepted hashes above. No PR created; did not wait for/check GitHub Actions or dispatch any deployment.
- Original preview checkout and local media auditions are preserved. Temporary integration checkout is clean after removing only its two task-created dependency symlinks and is being archived. This final acceptance note is local task memory; the published changeset includes the pre-integration plan/evidence.
- Next: owner's next requested revision. No UAT/Production release or customer OPEN acceptance is claimed.

## Item 37: distinguish larger-shop contact guidance from chooser results

- Owner finds the over-limit/contact sentence confusing directly under `เลือกคำตอบด้านบน เพื่อหาแพ็กเกจที่เหมาะกับร้านคุณ`.
- Plan: move the contact note below the four package cards, outside the chooser and its live result region. Give it the heading `ต้องการใช้งานมากกว่าที่แพ็กเกจรองรับ?`, explicitly conditional shop-size copy, and the action `คุยกับทีมงานใน LINE`. The chooser result will contain only its instruction or recommendation. Keep actual plan limits, recommendation logic, destinations and themes unchanged; verify the existing rendered suite and local availability.

### Item 37 result

- Moved the note into a separate compact text block after package cards and before the chooser. Added the planned heading and `ถ้าร้านมี...` wording, with `คุยกับทีมงานใน LINE` linking to the same contact destination. Removed it from `.ch-res` and its `aria-live` region so it cannot read as part of the personal recommendation. Replaced the now-unused `.ch-more` rule with scoped spacing/type rules for the contact block.
- Existing rendered homepage suite passed 9/9; `git diff --check` passed; the current default-theme local preview returned HTTP 200. No logic, limits, dependencies, backend or other-route changes; no new test needed for this reversible copy/layout change.
- No new browser visual verification because of the previously recorded URL-policy access rejection; no workaround attempted. Local preview is available for owner review. This follow-up is not committed, pushed, merged or deployed.

## Item 38: mascot-led interactive package guide

- Owner requests clearer introductory copy and a mascot that pops, changes pose and asks questions one at a time until the visitor finishes answering.
- Spec: `docs/specs/public-home-package-guide-spec.md`; plan: `docs/plans/public-home-package-guide-plan.md`. Inline guide, existing four questions/options and recommendation rule, one visible answer group, progress, back/edit, retained answers and automatic focus/scroll to the recommended card only on completion.
- Reuse reviewing/scanning mascot assets and the existing visibility helper. Native buttons, keyboard focus, stable answer layout, static reduced-motion fallback. No audio or new service/dependency/entitlement change. Preserve item 37's separate larger-shop note. Local prototype only for this revision.

### Item 38 implementation and verification

- Replaced the collapsed four-question form with an immediately visible inline guide, headed `ให้น้องมั่งมีช่วยเลือกแพ็กเกจ` / `น้องจะถาม 4 ข้อ กดคำตอบที่ตรงกับร้านคุณได้เลยค่ะ`. Questions retain their real shop-work meaning, now phrased as the mascot speaking; the first question separately reminds users to count themselves.
- One answer group is shown per step. Clicking moves to the next question; progress shows the current question out of four. Back/edit preserve chosen answers, and selecting the same choice again still advances. Completion includes a four-answer summary and edit control. Personalized package selection and automatic focus/scroll occur only on completion, using the unchanged `recommendedPlan`; monthly/yearly switching neither resets nor scrolls the guide.
- Reused `HomeAbilityPop` with an optional class name and both existing mascot images. First entrance observes visibility; keyed image changes alternate the phone/scanning and magnifier/reviewing artwork and trigger a 650 ms pop. Removed the old full-chooser scroll animation so it does not compete with the mascot. Reserved mascot/answer space, bubble/question layout, and two-column answer buttons are scoped to the guide, with mobile rules and default/plum colors. Reduced motion disables animation. Native focus brings new questions into view without stealing initial focus; completion retains the prior controlled card scroll.
- Updated the existing rendered interaction check rather than introducing a test framework: one visible answer set, initial focus untouched, alternating poses, answer progression/back/reselection, edits without premature completion, unchanged recommendation boundary cases, correct completion focus/scroll, no jump on billing changes, reduced-motion scroll and media asset existence. Full homepage suite passed 26/26; final `corepack pnpm exec tsc --noEmit --incremental false` passed. `git diff --check` passed; default local preview returned HTTP 200 on port 43831. The first new helper test exposed its mock treating component props as DOM refs; scoped that mock to actual div elements, then all tests passed.
- No actual 390/1280 browser observation or screenshot is claimed. Prior automatic approval review denied local browser access under URL policy; no alternate surface/workaround attempted. Owner preview: `http://127.0.0.1:43831/?preview=events&event=default&palette=plum#package-guide` (refresh for the new component).
- No commit, push, merge, PR, deployment, dependency/package.json, audio, backend, data model or entitlement changes. Item 37's larger-shop contact note remains outside the guide. Next: owner reviews the interactive local prototype.

## Item 39: address the visitor in the trust heading

- Changed the shared homepage heading from `น้องมั่งมีช่วยกรอก คนเป็นคนตัดสิน` to `น้องมั่งมีช่วยกรอก คุณเป็นคนตัดสิน`, exactly as requested. Applies to default and seasonal themes through the same `PublicHome` markup.
- Scope: copy only; no logic or behavior change. Verification: exact source-text replacement and `git diff --check`; no new test needed for this reversible wording edit.
- Local only; no commit, push, merge or deployment.

## Item 40: integrate the package guide and latest copy into main/develop

- Owner explicitly requests `เอาเข้า main+develop`. Carry forward direct integration without a PR and without checking/waiting for GitHub Actions. Scope: items 37–39 and their spec/plan/memory; exclude local reference/audio auditions and unrelated working directories.
- Refreshed target baselines: main `e63f99f01c042e47b256d3c7fa83bebc649fd823`, develop `18a0604bf613ee135cc03ef72ad282153820c09d`. Their existing public-home code matches the source baseline; retain each branch history and unrelated work by applying only this new scoped changeset in a temporary managed checkout. Preserve the local preview checkout.
- Pre-integration verification: all 26 homepage tests pass; `git diff --check` passes. Item 38 TypeScript check already passed and subsequent code change is the one-line trust heading. Actual-browser review remains blocked by the previously recorded URL-policy rejection; no visual verification claim or workaround.
- Plan: commit the seven scoped paths, apply to each remote baseline, check the integrated homepage tests and matching trees, then atomically push both refs without force and verify exact remote hashes. This request covers source integration; no deployment or customer acceptance is claimed.
