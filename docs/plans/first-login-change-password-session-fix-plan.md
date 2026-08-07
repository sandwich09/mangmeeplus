# First-login change-password session fix

## Defect

After an admin creates a company user, the user's first password login redirects to
`/change-password`, but submitting the temporary password can return 401 and show
“เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่”.

## Plan and acceptance criteria

- Keep login and forced password change on the same Next auth BFF boundary.
- Read both normal and chunked access-token cookies server-side and authenticate the API call with Bearer auth.
- Preserve API validation/status messages; do not expose tokens to browser JavaScript.
- Unit-test that the BFF forwarder sends the access token and password payload to the correct endpoint.
- Verify the focused web test suite and typecheck.
