# Local runtime theme verification — 2026-10-22

See the runtime plan and task memory for design, commands and release boundary. No cloud resources or production records were read/changed.

- `api-results.json`: real PostgreSQL + full Nest AppModule/guards/DTOs, transaction and audit checks.
- `browser-results.json`: actual API/DB-backed admin-to-home on/off, baseline geometry/content, CSRF, real concurrent tabs and permission gates. Only explicit loading/error presentation uses intercepted responses.
- `admin-final-iab.png`, `admin-final-1280.png`, `home-final-iab.png`: **final** reviewed UI after success-message positioning fix. Earlier `admin-selected-*` / `admin-saved-*` are intermediate verification captures; the clipped result message in the earlier desktop saved capture was fixed.
- `api-typecheck.txt`, `permission-checks.txt`: passing final checks. Web typecheck and 24 homepage tests also passed (see memory).

`local-api.cjs` is a local review/test harness, not production bootstrap. It runs the real compiled application against only the dedicated loopback database on 43834 and API on 43832; it keeps synthetic credentials in a 0600 `/tmp` file. Use `--check` only against the fresh, migrated dedicated DB, or omit it to restart the local review API. The normal application registers the same HomeThemeModule through AppModule.

`check-browser.mjs` requires that harness and the web dev server on 43831. It saves normal mode at the end. After verification the in-app browser was used to sign in through the real password form and enable Halloween for owner review, without preview query parameters. No push/merge/deploy.
