# ── Étape 1 : build Nuxt ──────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Étape 2 : image de production ─────────────────────────────────────────────
# .output contient déjà tout ce qu'il faut (serveur + dépendances embarquées).
FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/.output ./.output

ENV HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production

# Utilisateur non-root (uid 1000, comme l'utilisateur debian du serveur) :
# les fichiers créés dans les dossiers montés lui appartiennent.
USER node

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
