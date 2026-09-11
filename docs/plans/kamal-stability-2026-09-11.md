# Repeatable UAT Kamal release and rollback

Status: implementation and consolidated proof in progress; no stable/ten-minute claim yet.
Owner: release owner / Codex

Owner explicitly requests closing the known setup/controller/rolling-update gaps, using real UAT,
so recurring deployment does not depend on ad-hoc repairs. Production is unchanged and dev stays
stopped. Prior admin-merge authorization applies to the reviewed scoped fix after CI passes.

Implement the smallest complete source-controlled controller/helper set, fixed host bootstrap,
and graceful API shutdown. Preserve full config, image/source, provider, migration/authority and
customer OPEN acceptance. Bootstrap must create correct HOME/Kamal ownership, compatible proxy,
bounded logs and dependable package installation; render it into the existing private CloudFormation
template while preserving every resource/property other than intended UAT UserData. Review the real
change set before execution: EBS UserData changes restart instances, so bootstrap repair is a separate
setup operation and cannot be hidden as application-deploy time. No production/IAM/network expansion.

Close rollback before live execution: manual browser acceptance on UAT must also support rollback,
read back the actual preserved version rather than a newly invented container name, and verify
image/full environment/provider/authority/customer OPEN and sign the result. Any malformed evidence,
stale runtime or failed native action must retain the operation lock and fail without auto-retry.

Proof sequence: local focused positive/negative tests + actual native config parser + required
security checks; one PR/CI/admin merge; exact main hotfix update over current UAT; rollback that
hotfix to its observed previous source/config/provider; restore current main through the same
command. Each live run has one operation, an original full clock, browser evidence and signed result.
No ad-hoc continuation may count as a clean success. No pending migrations may enter this hotfix
proof. Retain failures and full attempt totals. User login remains manual; no password reset,
password/cookie export, fabricated identity or LINE acceptance. LINE remains explicitly unproven
until exercised on its real UAT channel; it is not a missing config/bootstrap blocker.

Acceptance: corrected bootstrap/controller available from a clean main checkout; preserved current
cloud template no longer reproduces the known HOME/proxy faults; clean live changed-source update,
rollback and final current-source restoration pass without repairs. Report exact durations with
human/automation stages, config coverage and the bounded scope of stability proof. Under10minutes
is a measured per-run outcome, not an unconditional guarantee against future application or provider
failures. Three clean operations are bounded regression evidence, not proof of every future release.
