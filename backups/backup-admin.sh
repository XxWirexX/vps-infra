#!/usr/bin/env bash
# Sauvegarde de l'état du panel admin (sites.json) : sous-domaines et maintenance.
# Les fichiers Traefik site-*.yml se régénèrent à partir de lui.
set -euo pipefail

SRC=/home/debian/infra/admin/data/sites.json
DEST=/home/debian/backups/admin
KEEP_DAYS=14

if [[ ! -f "$SRC" ]]; then
  echo "Rien à sauvegarder : $SRC n'existe pas encore"
  exit 0
fi

mkdir -p "$DEST"
FILE="$DEST/sites_$(date +%F_%H%M).json"

# Vérifie que le JSON est valide avant de le garder
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$SRC"
cp "$SRC" "$FILE"

find "$DEST" -name 'sites_*.json' -mtime +"$KEEP_DAYS" -delete

rclone copy "$DEST" ovh:wireredblue-backups/admin
rclone delete --min-age 90d ovh:wireredblue-backups/admin

echo "OK : $FILE, copié sur OVH"
