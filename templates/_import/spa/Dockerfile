# Ajouté par le panel admin (site Vite / Astro détecté). Adapte-le si besoin :
# "npm run build" doit produire le dossier dist/, servi ensuite par nginx.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* .npmrc* ./
RUN if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then corepack enable && yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    else npm install; fi
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
# Les routes de l'appli (SPA) renvoient vers index.html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / { try_files $uri $uri/ $uri.html /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
