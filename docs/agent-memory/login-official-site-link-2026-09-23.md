# Agent Memory: Login official site link

Status: implemented and verified, not deployed.
Owner: Codex.
Scope: public `/login` page only.
Decisions:

- Add a same-tab link to `https://official.mangmeeplus.com/` immediately below the legal links.
- Use `รู้จักมั่งมีพลัส` in Thai and `Explore MangmeePlus` in English. Do not imply the visitor is returning from another page.
- Match the QR entry point's text size, weight, color, and hover treatment, without an underline. Keep the link outside the legal-documents nav.

Open questions: none.
Artifacts: `apps/web/src/features/auth/LoginPage.tsx`.
Verification: `tsc --noEmit --incremental false -p apps/web/tsconfig.json` and `git diff --check -- apps/web/src/features/auth/LoginPage.tsx` passed.
Next: review and deploy through the normal release process when requested.
