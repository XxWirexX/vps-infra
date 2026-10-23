#!/usr/bin/env bash
set -euo pipefail

cd /home/debian/projects/dle
git pull origin main
docker compose build
docker compose run --rm migrate
docker compose up -d --remove-orphans
docker image prune -f

echo "Déploiement DLE terminé"
