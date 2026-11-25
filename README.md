# WatchDog-BMS
A Dog that never sleeps, always watching your stock, sales, KPI, accounts &amp; team — just like you built this platform to do. Loyal to your business. Sharp like your Rat hour.

## Platform Foundation

WatchDog-BMS uses an AWS-first, container-first monorepo:

- `apps/web` — Next.js web admin shell
- `apps/api` — NestJS ERP core API shell
- `apps/ai-gateway` — NestJS AI Gateway shell
- `apps/workers` — Node.js worker shell
- `packages/contracts` — shared API/event contract placeholder
- `packages/config` — shared environment config placeholder
- `packages/design-tokens` — shared web/LIFF theme token source
- `infra/docker` — local Docker Compose and deploy contract

Build shared theme outputs:

```bash
pnpm --filter @watchdog-bms/design-tokens build
```

## Local Docker

```bash
cp .env.example .env
pnpm install
pnpm docker:local
```

`pnpm docker:local` runs `docker compose up --build` attached, so the stack lives
only as long as that command. Add `-d` to keep it up after the terminal closes:

```bash
docker compose -f infra/docker/compose.local.yml --env-file .env up -d --build
docker compose -f infra/docker/compose.local.yml logs -f web api
docker compose -f infra/docker/compose.local.yml --env-file .env down
```

| Service | URL |
| --- | --- |
| web | http://127.0.0.1:3000 |
| api | http://127.0.0.1:3001/v1/health |
| ai-gateway | http://127.0.0.1:3002/v1/health |
| postgres | `127.0.0.1:15432` |
| redis | `127.0.0.1:6379` |
| minio | `127.0.0.1:19000` (console `19001`) |

### AI locally (LINE AI, demo chat, document reading)

`.env.example` ships the AI path switched on the way production runs it. It needs one
thing from you: a key in `.env`.

```bash
ANTHROPIC_API_KEY=<your key>
```

`MODEL_PROVIDER` stays `bedrock`; with the key present the gateway calls the Anthropic API
instead of AWS, so no AWS credentials are needed. Without a key every AI call fails and the
chat answers with its "try again" message. To try the sales demo: sign in as
`qa.mangmee.sales` / `Qa@MangmeeSales123`, open `/sales/demo-links`, create a link.

### Three things that block a fresh clone

**`pnpm dev` does not work on its own.** `ai-gateway` and `workers` require
`APP_ENV` and `SERVICE_NAME`, which live in `compose.local.yml`, not in
`.env.example`, and the service URLs there (`http://api:3001/v1`,
`redis://redis:6379`) only resolve inside the compose network. Use
`pnpm docker:local`.

**`apps/api/.env` may override your database.** Prisma writes a scaffold there
with `DATABASE_URL="postgresql://…@localhost:5432/mydb"`, and Prisma CLI reads
it in preference to the root `.env`. Point it at the same URL as the root
`.env` (port `15432`, database `watchdog_bms`) or Prisma commands fail with
`P1001`.

**Postgres is published on `15432`, not `5432`** (`POSTGRES_PORT` in
`compose.local.yml`). A container started with a different `.env` binds the
wrong port and nothing connects.

If the database predates the checkout, apply pending migrations before starting
the apps — `migrate deploy` applies them without touching existing data:

```bash
pnpm --filter @watchdog-bms/api exec prisma migrate status
pnpm --filter @watchdog-bms/api exec prisma migrate deploy
```

Docs source of truth starts at `docs/Home.md`. Current product direction is web-first full Business OS for data and operations; LINE is the AI chat, summary, alert, account-linking, and deep-link channel.
