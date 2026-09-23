# Sales agent profile access

Status: Implemented; local unit/type checks passed, DB/browser integration pending a running local stack

Goal: Admin console reads and edits every sales profile; a lead reads profiles of agents in their own team; each sales user reads and edits their own address, tax identity and bank details.

Plan:
1. Keep the existing encrypted profile model and admin permission. Add scoped lead and self endpoints with a service-level team/self check before decrypting. Keep withholding rate admin managed.
2. Reuse the existing team profile modal for lead read and admin edit. Add a discoverable own-profile page in the sales console. Preserve 13-digit validation and bank selection.
3. Audit each profile read and write without PII, verify API authorization and UI contracts with focused tests, and update task memory.

Acceptance: Cross-team and other-user reads return not found; a sales user cannot write another user's profile or withholding rate; admin can save profile; lead can read only their team; own edits persist encrypted; lists remain free of PII.
