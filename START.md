# Running domain-analyzer locally

## Prerequisites
- Node.js 20+
- Docker Desktop (for PostgreSQL)
- npm 9+

## First-time setup

```bash
cd Documents/repo/domain-analyzer

# 1. Install dependencies
npm install

# 2. Start PostgreSQL via Docker
docker compose -f docker-compose.dev.yml up -d

# 3. Run migrations + seed
npx prisma migrate deploy
npx prisma db seed

# 4. Start the dev server
npm run dev
```

Open http://localhost:3000 and click **Dev Login** — no Google OAuth needed.

Seed creates:
- `dev@incident.io` — Admin
- `sa@incident.io` — SA/SE
- Acme Corp — sample customer

## Subsequent starts (after first-time setup)

```bash
docker compose -f docker-compose.dev.yml up -d   # start Postgres
npm run dev                                        # start app
```

## Useful commands

| Command | What it does |
|---|---|
| `npm run db:studio` | Open Prisma Studio (visual DB browser) |
| `npm run db:reset` | Drop + recreate DB (re-run seed after) |
| `docker compose -f docker-compose.dev.yml down` | Stop Postgres |
| `npm run lint` | Run ESLint |
| `npm run build` | Production build check |
