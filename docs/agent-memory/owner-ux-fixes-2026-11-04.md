# Agent Memory: owner UX fixes 2026-11-04

Status: implemented in worktree `fx1-20261104` (branch `codex/owner-ux-fixes-20261104`, base develop `e28e60601`); not committed.
Owner: controller session.
Scope:
1. "คำว่าไฟล์ กิ๊ฟ เจเพ็ก ใดๆ สามารถใช้ภาษาอังกฤษทับศัพท์ได้เลย": file-type names on screen, in errors, guides and LINE replies are English (JPEG, PNG, HEIC, HEIF, GIF, PDF). "ไฟล์" stays Thai; CRM person names untouched.
2. "พอกดเปลี่ยนบริษัทในไลน์ ดันเจอเลขรหัสบริษัทยาวๆ ซึ่งไม่ควร": the Thai picker's "เลือกบริษัทนี้" was a message action, so LINE posted `/company <id>` as the user's bubble.

Decisions:
- Shared constants in `packages/contracts/src/expenses.ts` changed at the source; every consumer follows.
- Banner-only `TypeNamesWhole` removed (it only kept Thai-spelled names whole); `WholeWords` kept for the hints.
- LINE help card `wht.outside`: v6 record stays byte-identical; v7 gets an `O1104` LINE entry in `PLAIN_WORDS_HELP_DRAFTS` with "PDF".
- Picker select button is the existing `action=company-select` navigation postback (no authority; the server re-checks membership) with `displayText` `บริษัท <n> · <shop name>`; the number keeps two same-named shops apart. Typed `/company <id|number>` still works.

Open questions: none. The pager buttons still post `/companies page N` (no id), unchanged.
Artifacts: hashes re-pinned: getting-started source hash, v7 pack hash (gateway spec and `home-help-v6.json`), W00 manifest.
Verification: web suite 5161/5161; API focused specs; gateway help specs; API, web and gateway typecheck; contracts build; W00 frozen check.
Next: controller reviews, commits and pushes.
