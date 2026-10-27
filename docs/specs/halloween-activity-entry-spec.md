# Halloween activity entrance

Status: first-screen implementation complete and locally verified, 2026-10-27. The subsequent first-door gameplay/share increment is authorized in [mirror reveal spec](halloween-ghost-reveal-spec.md), which supersedes discussion-only boundaries below. Not deployed.

## Product

Public homepage visitors can press “ร่วมกิจกรรม” and choose among three Halloween doors. Build the entrance and chooser first, using the established cozy plum Halloween artwork and Thai brand spelling “มั่งมี”. Games and share-card generation are future increments.

Doors, in order:
1. Purple — “กระจกเผยร่างผี”: the “Halloween นี้คุณจะเป็นผีอะไร?” random ghost reveal, eventually producing a ghost character card. Owner replaced the four-question idea with entering a mirror room, magical reveal effects and one randomly chosen ghost from the approved pool of 22. Artwork production is authorized; gameplay is still discussion-only.
2. Orange — “คืนล่าลูกอมต้องสาป”: a 30-second candy-catching game.
3. Green — “คฤหาสน์ไร้ทางออก”: solve three short puzzles to escape a haunted mansion.

Each activity is independent. No all-doors reward, completion stamps, counters, leaderboard, saved best score, sign-in requirement, or participant tracking/storage. Component state is transient and resets on closing/reopening or page reload. Future sharing must include website and official LINE links in accompanying text; image URLs are not clickable.

### First-door card direction — owner revision, 2026-10-27

Owner approved all five country samples and requested the full 22-card image set on 2026-10-27. Reuse the five approved cards and produce the remaining 17 in the same country styles. This approval covers artwork production; gameplay implementation remains outside this increment.

- Thai (8): กระสือ, กระหัง, แม่นาก, นางตานี, นางตะเคียน, ปอบ, เปรต, กุมารทอง.
- Western (5): แดร็กคูลา, มนุษย์หมาป่า, ซอมบี้, มัมมี่, อสูรแฟรงเกนสไตน์.
- Japanese (5): ซาดาโกะ, ยูกิอนนะ, จิ้งจอกเก้าหาง, ยายสปีด, กัปปะ.
- Chinese (2): เจียงซือ, ผีเจ้าสาวแดง.
- Korean (2): ชองกักควีชิน — ผีหนุ่มโสด; ชอเนอกวีชิน — ผีสาวพรหมจารี.

Total: 22. This supersedes the earlier roster containing ผีปากฉีก, ฮานาโกะ, โรคุโรคุบิ, คาราคาสะ, ยมทูต and อัศวินหัวขาด. All card footers must show exactly “มั่งมีพลัส” with no appended asterisk/plus/other glyph, “mangmeeplus.com” and “LINE: @mangmeeplus”. The initial generated Thai sample accidentally added a cross-like glyph after the brand; it is an image error, not part of the wordmark.

Full-set feedback: replace กองกอย with กุมารทอง (still 22 cards); base ปอบ's character on ปอบหยิบ from บ้านผีปอบ instead of the first cute food-eating draft; make ซอมบี้ unmistakably undead, not a handsome Dracula-like figure. These replacements supersede any already-generated drafts.

Further owner feedback: เปรต must have a towering body, extremely long arms/legs, a needle-hole-sized mouth and huge palm-leaf-sized hands. มนุษย์หมาป่า and อสูรแฟรงเกนสไตน์ must have their own recognizable anatomy, clothing and poses, not inherited Dracula costumes. Preserve a region's card frame/layout, not the sample character's face, silhouette or outfit.

Latest Western direction supersedes the frightening revisions: all should be handsome/cool/cute while remaining distinct. Zombie is an overworked handsome undead office worker at a computer (pale green skin, strong tired eyes), Werewolf is a cool handsome wolf character in casual streetwear, Mummy is goofy/adorable with big eyes and a fully bandaged face, Frankenstein is handsome and striking with green skin, stitch marks, neck bolts and his own simple cool outfit. No shared Dracula costume/pose, no frightening monster treatment. Pop must use the signature downward gathered-finger scooping gesture (ท่าจก), not thumb-index OK circles.

Face/pose differentiation: Mae Nak, Nang Tani and Nang Takhian must have clearly different facial structure, hair, expressions and actions rather than one face in three outfits. Proposed revision direction: Mae Nak has a long oval face and a long-arm lime-picking pose; Nang Tani has a round warm tan face, playful manner and a banana-leaf parasol; Nang Takhian has a mature angular face, partly braided hair and a composed pose integrated with tree roots. Nine-tailed fox must be HUMAN FORM with fox tails, not a fox animal; use a distinctive silver-haired woman with nine clearly countable tails.

Artwork delivered locally in `output/halloween-ghost-cards/`: 22 selected PNG cards, a static catalog, metadata and generation provenance. The three Thai women and human-form fox use the revised faces/actions above. Generated images are artwork interpretations; they do not add gameplay, randomization or sharing to the current website. Footer destinations remain visible text on the images; real clickable sharing links belong to the later gameplay increment.

Additional artwork: one secret mascot front, “น้องมั่งมี จอมเวทฟักทอง”, is saved under `secret/`; one ordinary card back and one more elaborate SECRET card back for advertising are saved under `backs/`. Both backs conceal character identity and use the collection name and exact brand/contact footer. Owner rejects the proposed promotional line “เปิดทุกครั้ง ได้การ์ดทุกครั้ง”; omit that wording from the future UI and advertising. This copy decision does not change the owner's rule that a completed draw returns one card. Sound effects, country-specific reveals and image/link sharing are still discussion-only. The suggested SECRET 1% / ordinary 4.5% each split has not been explicitly confirmed.

## This increment

- Show the activity entry only when the existing homepage event is Halloween. Leave the normal homepage markup, links and layout unchanged.
- Owner refinement, 2026-10-27: keep “ก๊อก ก๊อก…”, follow it with a more inviting “เปิดประตูมาสนุกกัน!”, remove the entrance button's diagonal line-arrow, and give the event invitation slightly stronger plum/pumpkin contrast. Keep its footprint modest and Thai text readable on mobile.
- The entry opens an accessible native modal containing the three clearly illustrated doors, concise titles and short descriptions. Desktop uses three columns; narrow screens remain readable and touch friendly without horizontal page overflow.
- Door selection may show a brief game introduction marked “เร็ว ๆ นี้”; do not imply unfinished gameplay or sharing already works. Allow choosing another door.
- Close by visible button, Escape or backdrop; restore focus to the entrance and reset selected-door state on reopening. Keyboard focus stays within the open modal; opening/closing must not break normal page scrolling.
- Respect reduced motion and the existing event pause control. Reuse current characters; CSS or inline SVG door illustrations are sufficient.
- Remove the arrow glyphs from door actions and the return-to-doors button as well as the entrance CTA.
- Owner requested automatic quiet spooky music and no mute control. Start a soft original bell/drone loop during the entrance click (browser user gesture), keep it playing through chooser/intro changes, and stop/dispose on every modal dismissal or component unmount. Reopening creates exactly one loop. No audio before entry or on other routes. The existing effects pause checkbox controls motion only.
- Use native Web Audio with no new dependency, third-party track, external audio request or stored preference. A blocked/unavailable audio API must not prevent the chooser from opening or produce an unhandled rejection. Device/browser sound restrictions may still prevent playback; never claim sound can override them.

## Architecture and boundaries

Use a small client component within `public-home`, mounted by `PublicHome` only for Halloween. Scope CSS under `.public-home[data-home-event="halloween"]`. Reuse the existing native-dialog approach. No new dependencies, package.json edits, API/contracts/database/admin changes, global theme changes, analytics, cookies, browser storage or external calls for this activity. Existing site requests are outside this feature's state contract.

Local implementation and browser preview only. No cloud operation, deploy, commit, push or merge is requested.

## Acceptance

- Entry → three doors → introduction → another door/close/reopen works with pointer, touch and keyboard.
- Spooky door titles describe three distinct games; preserve “Halloween นี้คุณจะเป็นผีอะไร?” as the random-reveal description. No reward/progress UI or persistent participant data.
- At 360/390/768/1280 widths, text, door controls and modal dismissal remain usable; test reduced motion and short landscape viewport.
- Normal/unknown themes mount no activity. Direct and client navigation to non-home routes leave no activity or event effects.
- Existing homepage unit tests and focused browser checks pass; inspect desktop/mobile screenshots and record limitations.
- Verify real Web Audio starts from entry, produces a quiet nonzero signal, loops without restart on door changes, and closes on Escape/X/backdrop/unmount. Test repeated openings and unavailable/rejected audio without UI failure.


## Scheduled door countdown — 2026-10-27 owner refinement

- Owner confirmed absolute Bangkok time: game2/candy opens29October2026 at00:00+07:00 (`2026-10-28T17:00:00Z`); game3/escape opens30October2026 at00:00+07:00 (`2026-10-29T17:00:00Z`). Never recalculate these relative to each visitor’s day.
- Owner explicitly chose waiting/countdown screens only; gameplay for2/3 is a separate discussion. This supersedes the initial request’s implication that bothgames must be implemented immediately. Do not invent mechanics or show a functioning-play claim while thosegames are absent.
- Show a live days/hours/minutes/seconds countdown on both unopened doors and their existing intro screens. Update fromabsolute time, not decrementing a savedcounter. Atdeadlinezero, hide the numeric countdown automatically without navigation/reload. Untilactualgameimplementation, keep truthful “กำลังเตรียมเกม” status and the existing backcontrol; nofakeplaybutton. Futuregameintegration must use these same cutoffs and render readycontrols only oncegameexists anddeadlinepassed.
- Keep game1available. Preserve theme-off gating, native-dialog focus/close behavior, ambience lifecycle, noarrows/mute, no participant records. No newdependency,serverendpoint,API,storage orclock overrideinproduct. Datesare interpretedAsia/Bangkok; thispublicnon-prize countdown uses thedeviceclock, not a security gate.
- Tick only while thedialogisopen; cleanupintervalandvisibilitylistener onclose/unmount; resyncimmediately onforeground. Avoid screen-reader announcements everysecond; use readable labels, tabularnumbers, and phone-safe layout.
- Evidence: focuseddateboundary/format checks and actual390/1280browser, including 1secondbefore/exactdeadline, separateunlocktimes, auto-disappearance onopenintro, foregroundresync, close/reopen cleanup and themeoff.
