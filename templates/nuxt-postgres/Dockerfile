# ── Dépendances ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# ── Build ─────────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN npm run build

# ── Migrations (service "migrate", lancé par deploy.sh) ───────────────────────
FROM deps AS migrate
COPY drizzle ./drizzle
COPY server/db ./server/db
USER node
CMD ["npx", "tsx", "server/db/migrate.ts"]

# ── Production ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/.output ./.output
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
