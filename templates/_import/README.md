# Fichiers ajoutés à l'import d'un repo

Quand on importe un repo existant depuis le panel, l'agent devine son type et ajoute,
**seulement s'ils manquent**, le Dockerfile et le `.dockerignore` du dossier correspondant,
un `docker-compose.yml` et le workflow de déploiement. Il ne remplace jamais un fichier existant.

| Dossier | Détecté quand | Port |
|---|---|---|
| `nuxt/` | `nuxt` dans package.json | 3000 |
| `spa/` | `astro`, ou `vite` sans script `start` | 80 |
| `node/` | autre package.json (`npm run build` puis `npm start`) | 3000 |
| `python/` | requirements.txt ou pyproject.toml | 8000 |
| `static/` | index.html à la racine | 80 |

Un repo qui a déjà un `docker-compose.yml` ou un `Dockerfile` est gardé tel quel (seul le compose
est ajouté s'il manque). Sinon, un compose de démo est ajouté, à remplacer.
