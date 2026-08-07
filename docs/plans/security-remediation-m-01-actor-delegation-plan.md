# Security Remediation Plan: M-01 Actor Delegation

## Product evidence

- Goal: an internal AI workload cannot choose an arbitrary active ERP actor after obtaining only the workload credential.
- Users/journey: linked LINE staff requests keep working through local or AgentCore orchestration; unlinked, revoked, substituted, expired, or replayed identities fail before ERP tool execution.
- Rules and acceptance criteria: `docs/specs/line-ai-local-agent-orchestration-spec.md` section 21.

## Architecture evidence

- API is the only delegation issuer and verifier; its dedicated signing key is never configured in AI Gateway or AgentCore.
- Each permitted registered tool receives a bounded pool of eight 120-second single-use tokens, matching the tool-call budget; every token binds actor, company, membership, request, tool, workload audience, and unique id.
- ERP Core verifies workload secret + delegation, atomically consumes the unique id in shared Redis, then re-resolves current DB permission/ABAC state.
- Accepted delegation consumption writes a redacted durable audit correlation event.
- No schema migration or direct AI data access is introduced.

## Implementation

- [x] Add API-only delegation key validation and current ECS/local secret wiring.
- [x] Add signed-token issue/verify/Redis-consume service with focused adversarial tests.
- [x] Add the delegation map to the LINE turn and AgentCore runtime contracts.
- [x] Forward only the token matching the selected tool.
- [x] Require and consume the token in `InternalToolsController` before access resolution/tool execution.
- [x] Record workload-to-actor audit correlation without token material.
- [x] Update M-01 checklist evidence only after verification passes.

## Integration evidence

- [x] Actor substitution denied.
- [x] Replay denied atomically.
- [x] Cross-company substitution denied.
- [x] Wrong tool and wrong audience denied.
- [x] Expired delegation denied.
- [x] Current membership, `ai.tool.invoke`, tool permission, and ABAC re-resolution tests remain green.
- [x] Contracts, config, API, AI Gateway, and AgentCore typechecks/builds pass.
- [x] Shell/deployment static checks and `git diff --check` pass.

## Release evidence

- [ ] Deploy immutable API, AI Gateway, and AgentCore revisions from clean CI with approval evidence.
- [ ] Verify live, sanitized task/runtime configuration: signing key present only in API; AI Gateway and AgentCore absent.
- [ ] Exercise one accepted call plus substitution, replay, cross-company, wrong-audience, and Redis-unavailable denials against the authorized environment; retain audit correlation and alert evidence.

Release execution uses the existing isolated UAT data plane. CI retains a checksum-bound
AgentCore CodeZip for the exact commit; the UAT API release-task image runs the adversarial
probe without adding a public test route. The probe is refused outside `DEPLOY_ENV=uat`,
and the signing key is injected only into that short-lived API verification task.

## Rollback

Revert the M-01 commit and disable AI tool traffic while rolling back. Do not restore shared-secret-only actor selection. Existing database records are unaffected; Redis replay keys expire automatically.
