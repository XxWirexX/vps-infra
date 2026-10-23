#!/usr/bin/env bash
set -euo pipefail

DEST=/home/debian/backups/dle
KEEP_DAYS=14
FILE="$DEST/dle_$(date +%F_%H%M).dump"

mkdir -p "$DEST"
trap 'rm -f "$FILE.tmp"' ERR

# Dump de la base
docker exec dle_db pg_dump -U dle -d dle -Fc > "$FILE.tmp"

# Vérifie que le dump est lisible avant de le garder
docker exec -i dle_db pg_restore -l < "$FILE.tmp" > /dev/null
mv "$FILE.tmp" "$FILE"

# Supprime les sauvegardes locales de plus de 14 jours
find "$DEST" -name 'dle_*.dump' -mtime +"$KEEP_DAYS" -delete

# Copie hors du serveur
rclone copy "$DEST" ovh:wireredblue-backups/dle

# Garde 90 jours d'historique hors du serveur
rclone delete --min-age 90d ovh:wireredblue-backups/dle

echo "OK : $FILE ($(du -h "$FILE" | cut -f1)), copié sur OVH"
