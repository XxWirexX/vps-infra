# ── Étape 1 : compilation TypeScript ─────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Étape 2 : image de production (sans devDependencies) ─────────────────────
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3000
# Les variables d'env sont injectées par Docker (env_file dans compose),
# pas besoin du flag --env-file ici.
CMD ["node", "dist/index.js"]
