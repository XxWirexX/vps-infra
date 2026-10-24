#!/usr/bin/env bash
# Déploiement générique d'un projet de ~/projects/<id>.
#
# Appelé par :
#   - GitHub Actions, via une clé SSH restreinte à ce script ET à ce projet :
#       command="/home/debian/infra/deploy/deploy.sh <id>",restrict ssh-ed25519 ...
#   - l'agent, pour le premier déploiement d'un projet créé depuis le panel.
#
# Si le compose déclare un service "migrate" (profil "tools"), il est lancé
# avant de redémarrer l'application, comme pour DLE.
set -euo pipefail

ID="${1:-}"
if [[ ! "$ID" =~ ^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$ ]]; then
  echo "Identifiant de projet invalide : '$ID'" >&2
  exit 2
fi

DIR="/home/debian/projects/$ID"
if [[ ! -d "$DIR/.git" ]]; then
  echo "Projet introuvable : $DIR (pas de dépôt Git)" >&2
  exit 2
fi
# Tous les noms de fichier que Docker Compose reconnaît
found=""
for f in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  [[ -f "$DIR/$f" ]] && found="$f"
done
if [[ -z "$found" ]]; then
  echo "Aucun fichier compose dans $DIR (docker-compose.yml, compose.yaml…)" >&2
  exit 2
fi

# Un seul déploiement à la fois par projet
exec 9>"/tmp/deploy-$ID.lock"
flock 9

cd "$DIR"
echo "▶ Récupération du code"
git pull --ff-only   # branche suivie (main, ou la branche principale du repo importé)

echo "▶ Construction des images"
docker compose build

if docker compose --profile tools config --services | grep -qx migrate; then
  echo "▶ Migrations"
  docker compose run --rm migrate
fi

echo "▶ Démarrage"
docker compose up -d --remove-orphans
docker image prune -f > /dev/null

echo "✔ Déploiement de $ID terminé"
