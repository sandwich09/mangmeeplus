# Security Implementation Guideline

Use this checklist before implementing or reviewing any feature. Security rules are part of the feature scope, not follow-up cleanup.

## Default Rules

- Deny by default: no protected route may proceed without verified identity, company context, and explicit permission.
- Keep authentication separate from authorization: LINE Login validates identity for LINE and LIFF account-link entry; WatchDog-BMS owns first-party sessions, company membership, roles, permissions, and audit rules.
- Treat tenant and company context as server-derived data. Do not trust client-submitted `companyId`, role, permission, price, tax, or approval state without server validation.
- Do not add business data routes before an auth boundary, permission guard, and test path exist.
- Do not log secrets, tokens, passwords, raw authorization headers, full cookies, or sensitive document contents.

## Backend API Checklist

- Route has a use case boundary and controller stays thin.
- Input DTO validates shape, limits, enum values, text length, amount bounds, and required IDs.
- Global validation stays strict: whitelist unknown fields, forbid non-whitelisted fields, and transform typed input.
- Mutating route checks company membership and required permission before writing.
- Read route checks permission and tenant scope before returning data.
- Sensitive mutation writes an audit event with user, company, action, target, timestamp, and request ID.
- Error responses do not expose stack traces, SQL details, provider secrets, or internal policy logic.
- Pagination, filters, imports, exports, and search endpoints have bounded limits.
- Bulk operations are idempotent or use explicit idempotency keys when retry is possible.

## Web and LINE Client Checklist

- Client stores no long-lived secrets.
- Client treats server authorization as source of truth; UI hiding is not access control.
- User-controlled text renders escaped by default. Do not use raw HTML rendering unless reviewed and sanitized.
- API clients attach request IDs and auth headers through shared helpers.
- Forms show validation, but backend repeats all security-critical validation.

## AI Gateway Checklist

- AI Gateway calls ERP core through permission-checked APIs or tools, not direct database access.
- Tool invocation checks user, company, permission, tool policy, and allowed target objects.
- Prompt input and tool output are treated as untrusted data.
- Tool calls that read or mutate sensitive data are audited.
- AI responses must not reveal hidden policy, credentials, raw prompts, or cross-tenant data.
- Destructive or money/stock/tax-affecting actions require deterministic server-side validation before execution.

## File and Object Storage Checklist

- Uploads use signed URLs or backend-controlled upload endpoints.
- Validate content type, file extension, file size, and ownership before accepting a file.
- Store files under tenant-scoped keys.
- Downloads check company membership and permission before issuing access.
- Do not make buckets public for business documents.

## Secrets and Configuration Checklist

- Real secrets stay out of git and local docs.
- Production secrets come from managed secret storage, not `.env` files baked into images.
- Production startup fails if required secrets, LINE channel config, WatchDog session/JWT config, database URL, Redis URL, CORS origins, or storage config are missing.
- `.env.example` may contain local-only placeholder values, never real credentials.
- Public `NEXT_PUBLIC_*` values must be safe for browser exposure.

## Infrastructure Checklist

- Local Docker ports bind to `127.0.0.1` unless external access is intentional.
- Production containers run as non-root users.
- Docker builds use a frozen lockfile.
- Workers have no public inbound HTTP.
- Swagger/OpenAPI UI is disabled in production unless protected by private network or authentication.
- Health endpoints expose availability only, not secrets, version internals, or dependency credentials.

## Dependency and CI Checklist

- Run `pnpm security:audit` before merging dependency or release changes.
- Patch high severity dependency findings before feature work continues.
- Use lockfile updates in the same change as package updates.
- Add CI gates for typecheck, tests, dependency audit, secret scan, and container scan before staging/prod release.

## Required Tests

- Unauthenticated request is rejected for protected routes.
- Authenticated user without company membership is rejected.
- Authenticated user without required permission is rejected.
- Cross-company read/write attempt is rejected.
- Allowed request succeeds and writes audit log when required.
- Invalid input, oversized payload, unknown fields, and invalid enum values are rejected.
- AI Gateway cannot bypass ERP core permission checks.

## Review Blockers

- Business route without permission rule.
- Mutation without audit requirement decision.
- Client-trusted tenant, role, permission, tax, price, or approval state.
- Raw SQL or query helper without tenant filter.
- File upload without type and size validation.
- New environment variable missing `.env.example` documentation.
- New package without audit result or clear need.
