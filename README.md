# This is private repo, side project for study ERP, AI, End to End promote product by self
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

Copy `.env.example` to `.env`, install dependencies, then run:

```bash
pnpm docker:local
```

Docs source of truth starts at `docs/Home.md`. Current product direction is web-first full Business OS for data and operations; LINE is the AI chat, summary, alert, account-linking, and deep-link channel.
