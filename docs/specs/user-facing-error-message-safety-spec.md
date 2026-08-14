# User-Facing Error Message Safety Spec

Status: IMPLEMENTED
Date: 2026-08-15
Owner: web/platform
Related:
- `docs/specs/feature-disabled-error-honesty-spec.md`
- `docs/specs/web-core-workspace-spec.md`
- `docs/plans/global-toast-feedback-plan.md`
- `docs/qa/production-readiness-audit-consolidated-2026-08-09.md`
- `docs/agent-memory/user-facing-error-message-safety.md`

## 1. Problem

The web currently preserves API error bodies in thrown `Error` objects and, in several
customer-visible paths, renders `Error.message` directly. NestJS validation responses can carry a
`message: string[]`; `authedApiFetch` joins that array into a sentence before throwing. When the
strict API DTO rejected a stale client-owned field during substitute-receipt signing, the user saw:

```text
property visibility should not exist
```

The API correctly rejected the unknown field. The product failure was that framework vocabulary,
an internal property name, and no useful next action reached the screen. The same failure class can
appear in any feature using the shared API client, in an inline banner that bypasses the shared
translator, or in a persisted workflow/delivery diagnostic.

The existing error-honesty spec requires one shared display seam and forbids raw `Error.message`,
but its earlier fallback deliberately passed unknown server sentences through. This spec supersedes
that rule for an **API-shaped unknown error**: customer UI fails closed to a Thai, actionable
status/kind fallback. Raw diagnostic data remains available to application logic and support, but is
not customer copy.

## 2. Goals

1. No customer-visible web surface displays framework validation grammar, internal field names,
   raw stable codes, transport placeholders, third-party diagnostics, or unreviewed API messages.
2. Preserve the most specific reviewed business guidance when a stable code, exact message, or
   message pattern is already mapped.
3. Give an honest Thai next action for every unknown API-shaped error based on status or error kind.
4. Apply the same presentation rule to mutation toasts, inline banners, load/error states, forms,
   dialogs, persisted workflow/delivery failure summaries, and diagnostics returned inside an
   otherwise successful response.
5. Keep strict API validation, response diagnostics, request correlation, security boundaries, and
   global toast ownership unchanged.

## 3. Non-goals

- Do not weaken `ValidationPipe`, remove `forbidNonWhitelisted`, change DTO ownership, or alter the
  NestJS validation `message: string[]` response contract.
- Do not translate every API error code in one pass. Reviewed code/message mappings remain the
  specific layer; the safe fallback prevents unmapped codes from becoming customer copy.
- Do not redesign the toast component, queue, timing, tone, position, accessibility role, or dedup.
- Do not add a second error toast at feature call sites.
- Do not change backend 5xx exception hardening, logging, redaction, or response shaping in this
  task. Any backend hardening discovered here is a follow-up.
- Do not rewrite historical persisted diagnostic text. Only its customer-facing rendering changes.
- Do not replace field-level client validation or add a system-wide field-label catalogue.

## 4. Definitions

### 4.1 API-shaped error

An error is API-shaped when at least one of these signals is present:

- numeric `status` or `statusCode`;
- a recognized API error `kind` such as `validation`, `forbidden`, `server_error`, or
  `network_error`;
- a stable API `code`;
- parsed response `details`, including NestJS `message`, `statusCode`, `error`, or `requestId`;
- a network exception caught while the shared API client is executing a request;
- a malformed success response classified by the shared client as `invalid_response`.

A plain, UI-authored validation string that is not attached to an API-shaped error is not changed by
this spec. Feature code may continue showing reviewed local copy such as supported file types or a
required checkbox.

### 4.2 Reviewed mapping

A reviewed mapping is customer copy registered in the shared error translator or an approved
domain translator. It can be selected by:

1. stable `code`;
2. exact server message;
3. approved parameterized message pattern.

The mapping must describe the real rule and, when the journey stops, tell the user what to do next.

### 4.3 Raw diagnostic

Raw diagnostic data includes the original `Error.message`, response `details`, validation arrays,
stable codes, persisted provider/workflow failure text, request id, and transport exception. It may
be retained for branching, retry policy, logging, and support correlation. It is not display copy.

## 5. Required Resolution Order

Every customer-visible API error must resolve through the shared presentation function in this
order:

1. Map a stable `code` through the shared/domain reviewed catalogue.
2. Map the original message through exact and parameterized reviewed mappings.
3. If the error is API-shaped and still unknown, select a Thai fallback from `status`, then
   `statusCode`, then `kind`.
4. If the API shape has no usable status/kind, show the generic API failure fallback.
5. Only a non-API, UI-authored error may retain its already-reviewed local message.

An arbitrary Thai or English string from an API is still unreviewed input. Being readable or already
Thai does not allow it to bypass the catalogue and fallback policy.

## 6. Canonical Unknown-Error Copy

These sentences are the canonical fallbacks for this task. A reviewed code/message mapping always
wins over them.

| Signal | Customer copy |
|---|---|
| network / `network_error` | `เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่` |
| 400 or 422 / `validation` | `ข้อมูลจากหน้าจอไม่ตรงกับที่ระบบรองรับ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง` |
| 401 / `unauthorized` | `เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่` |
| 403 / `forbidden` | `คุณไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อเจ้าของร้าน` |
| 404 / `not_found` | `ไม่พบข้อมูลที่ต้องการ` |
| 409 | `ข้อมูลถูกเปลี่ยนแปลงระหว่างทำรายการ กรุณาเปิดใหม่แล้วลองอีกครั้ง` |
| 413 | `ไฟล์หรือข้อมูลที่ส่งมีขนาดใหญ่เกินไป กรุณาลดขนาดแล้วลองใหม่` |
| 429 / `rate_limited` | `ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง` |
| 500 / `server_error` | `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง` |
| 502 | `เชื่อมต่อระบบไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้ง` |
| 503 | `ระบบกำลังปรับปรุงหรือมีผู้ใช้งานหนาแน่น กรุณารอสักครู่แล้วลองใหม่` |
| 504 | `ระบบตอบกลับช้าเกินกำหนด กรุณาลองใหม่อีกครั้ง` |
| other 4xx | `ทำรายการไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง` |
| other 5xx | `ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง` |
| API-shaped with no usable signal | `ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง` |

The 400/422 fallback intentionally does not name a raw property. Unknown DTO validation often means
the page and API contract do not agree, which the user cannot fix by editing an internal field.

## 7. Display Boundaries

### 7.1 Shared API clients

- `authedApiFetch` continues to retain the parsed body in `details` and the original error data for
  branching/support.
- A rejected mutation emits exactly one error event through the existing toast bus.
- A network rejection during a mutation follows the same ownership rule and emits one friendly
  network toast before the promise rejects.
- Failed GET requests do not gain automatic toasts; their owning screen renders the shared friendly
  message in its existing error state.
- `suppressErrorToast` keeps its existing meaning.
- The legacy `HttpClient`/`ApiError` path recognizes `statusCode` and `kind` consistently with
  `status`; it must not reintroduce raw validation text.

### 7.2 Feature screens

Mounted customer-visible feature code must not use an API error's `.message` as JSX, banner state,
toast input, dialog copy, or form summary. It must call the shared renderer directly or a domain
renderer that delegates to it before falling back.

Inspecting raw `code`, `details`, or message for non-display control flow remains allowed. Prefer a
stable `code`; an existing message-based predicate may remain only when changing its API contract is
outside scope and the raw value is never rendered.

### 7.3 Persisted workflow and delivery diagnostics

Fields such as persisted `errorMessage`, provider delivery failure text, workflow worker diagnostics,
or report-generation details are not trusted customer copy. A customer surface must:

1. render a reviewed stable error-code mapping when one exists; otherwise
2. render a generic Thai failure sentence appropriate to that workflow.

Raw persisted diagnostics remain available to authorized support/operations paths and logs. This
task does not make them visible through a customer disclosure control.

### 7.4 Diagnostics inside successful responses

Warnings, validation results, import-row errors, readiness checks, and similar fields returned with
HTTP 2xx are still server-authored diagnostics. A customer surface must render them through a
reviewed code/check-key/message mapping, with a Thai domain fallback for an unknown value. It must
not render or join the raw array/string merely because the enclosing request succeeded.

### 7.5 Malformed success responses and network classification

- A 2xx response whose declared JSON body cannot be parsed is an API `invalid_response` failure and
  uses the generic server-failure copy. The parser exception may remain as `cause` for diagnostics.
- A request is classified as a network failure only at the fetch boundary (or by an explicit
  network kind). An arbitrary application `TypeError` must not be described as an internet problem.
- If session refresh fails because of a temporary network/5xx dependency failure, the original
  request must not tell the user that the session expired or force a login. It uses temporary
  connection/server copy while preserving the existing retry and redirect policy.
- Stable response codes survive every legacy HTTP status branch so reviewed code copy can still
  take priority over a generic status fallback.

### 7.6 Accessibility and duplicate feedback

- Error toasts remain `role="alert"` and dismissible under the existing toast contract.
- An inline error may remain for persistent context, but a feature must not emit a second API error
  toast in addition to the mutation seam.
- Success/warning behavior is unchanged.

## 8. Security and Privacy

- Strict request validation remains fail-closed.
- Internal property names, class-validator grammar, SQL/Prisma/provider text, stack traces, storage
  identifiers, and cross-tenant hints must not be copied into customer UI.
- Sanitizing display text must not erase raw diagnostic fields from the thrown error object or logs.
- The renderer must not log the error as part of translation.
- Request ids remain available for support correlation but are not automatically appended to a
  transient toast.

## 9. Acceptance Criteria

- [x] Given HTTP 400 with `message: ["property visibility should not exist"]`, every
  customer-visible renderer returns exactly
  `ข้อมูลจากหน้าจอไม่ตรงกับที่ระบบรองรับ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง`.
- [x] The same case never renders `visibility`, `property`, `should not exist`, `Bad Request`, or
  `API error 400` in a toast, banner, form summary, or load/error state.
- [x] A known stable code or reviewed message remains more specific than the generic fallback.
- [x] Unknown API-shaped errors resolve by `status`, `statusCode`, or `kind`; both shared client
  models produce the same customer copy.
- [x] A network failure produces the canonical Thai network sentence. A failed mutation emits it
  once; a failed GET leaves rendering to the screen.
- [x] Default NestJS `Internal server error` and other unknown 5xx text never appear to the user.
- [x] Parsed response arrays, original message, code, details, and request id remain available to
  application logic/support after presentation mapping.
- [x] Mounted feature screens do not display an API `.message` directly. A source guard fails on new
  direct-display bypasses and documents narrow non-display exemptions.
- [x] Persisted workflow/delivery diagnostic text is displayed only through a code mapping or a
  generic Thai workflow failure sentence.
- [x] Import, preview, readiness, and other success-payload diagnostics use reviewed domain copy or
  a safe Thai fallback; raw arrays/codes/operator messages are not joined into the UI.
- [x] Malformed 2xx JSON is classified as `invalid_response`, retains its parser exception only as
  diagnostics, and displays generic server-failure copy.
- [x] Only a fetch-boundary failure or explicit network kind produces network copy; an unrelated
  application `TypeError` does not blame the user's internet connection.
- [x] A temporary refresh outage does not produce the session-expired instruction.
- [x] Stable codes survive the legacy response mapper for 404, 429, and 5xx responses.
- [x] One failed mutation produces one error toast even when a feature also keeps inline error state.
- [x] `GLOBAL_VALIDATION_PIPE_OPTIONS`, DTO ownership, validation response arrays, toast layout,
  toast dedup, `suppressErrorToast`, and the shared mutation-toast owner are unchanged.
- [x] Error toasts retain `role="alert"`.

## 10. Required Tests

### Unit: shared renderer

Cover at least:

1. the exact `visibility` validation array and exact canonical Thai result;
2. a second unknown validation array;
3. known code plus technical message, proving code priority;
4. `statusCode` without `status`;
5. default 500 text;
6. fetch/network error and `network_error` kind;
7. a reviewed local non-API message that remains unchanged;
8. assertions that technical tokens and raw snake-case codes are absent.

### Unit: API seam

- POST/PATCH 400 validation array emits one mapped toast before rejection and preserves raw
  `details` on the rejected error.
- A rejected fetch on a mutation emits one network toast before rejection.
- A rejected fetch on GET emits no automatic toast.
- `suppressErrorToast` still suppresses the mutation toast.
- A malformed 2xx JSON body becomes an API-shaped `invalid_response`; the raw parser error is not
  presentation copy.
- A non-network application `TypeError` does not resolve to network copy.
- Initial 401 plus a transient refresh 5xx/network failure resolves to temporary outage copy and
  preserves the no-login-redirect behavior.
- Stable codes remain present after every legacy response status mapping.

### Source guard

Scan mounted feature source for direct API-error display patterns such as setting error UI or calling
`toast.error` with `.message`. Keep a small explicit allowlist only for non-display predicates or
known local-only errors; each exemption states why it cannot render API text.

Also guard common successful-result bypasses such as rendering `.errors`, `.warnings`, or a raw
readiness/check `.message` without a reviewed domain renderer.

### Browser E2E

Intercept one real mounted mutation with:

```json
{
  "statusCode": 400,
  "message": ["property visibility should not exist"],
  "error": "Bad Request"
}
```

Trigger the action and assert that one visible `role="alert"` contains the canonical Thai fallback
and contains none of `visibility`, `property`, or `should not exist`. One representative mutation is
sufficient because the behavior is owned by the global seam.
