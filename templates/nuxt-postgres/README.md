# __PROJECT_NAME__

Nuxt + Postgres (Drizzle), en ligne sur https://__PROJECT_HOST__

## Dev local

```bash
docker run -d --name __PROJECT_ID__-dev-db -e POSTGRES_USER=app -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=app -p 5432:5432 postgres:16-alpine
cp .env.example .env   # puis DATABASE_URL=postgres://app:dev@localhost:5432/app
npm install
npm run db:migrate
npm run dev
```

## Modifier la base

1. Modifie `server/db/schema.ts`
2. `npm run db:generate` crée une migration SQL dans `drizzle/`
3. Commit et push : le déploiement applique la migration avant de relancer l'app

Toujours passer par des migrations générées, jamais par `drizzle-kit push` sur la prod :
`push` modifie la base sans rien inscrire dans le registre des migrations.
