# trykt

Node 22, pnpm, and Docker.

```text
docker compose up -d
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm dev
```

`TMDB_API_KEY` is a personal non-commercial developer key. `BETTER_AUTH_SECRET` is a local secret. Mail prints to the terminal. `pnpm db:reset` drops and migrates the dev database. Tests use `TEST_DATABASE_URL`. The first search fills the catalog. There is no seed.
