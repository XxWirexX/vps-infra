# Panel admin

`https://admin.wireredblue.xyz`, derrière le portier.

- **Sites** : attribuer un sous-domaine à un conteneur, le modifier, le supprimer.
- **Maintenance par site** : envoie le site vers la page 503, instantanément.
- **Filet de sécurité** : bascule les domaines sans site entre 404 et maintenance.
- **État** : vérifie toutes les 30 s que chaque conteneur répond.
- **Protection** : un site peut être « Protégé par le portier » (connexion obligatoire, via le middleware `portier@docker`). La visibilité « Privé » cache seulement le site du hub, elle ne le protège pas.
- **Hub** : chaque site a une visibilité (public, privé, masqué) et une description, affichées sur `hub.wireredblue.xyz` (voir `hub/README.md`).
- **Nouveau projet** : repo GitHub, clés, CD et premier déploiement en un clic, via l'agent du serveur (voir `agent/README.md`).

## Fonctionnement

Le panel ne touche ni à Docker ni aux conteneurs. Pour créer un projet, il passe par l'agent
(socket Unix `agent/run/agent.sock`). Pour le reste, il écrit seulement des fichiers :

| Ce qu'il écrit | Dossier sur le serveur | Lu par |
|---|---|---|
| `sites.json` (la source de vérité) | `admin/data/` | le panel |
| `site-<id>.yml` (une route par site) | `traefik/dynamic/` | Traefik, rechargé à chaud |
| `maintenance` (drapeau) | `maintenance/flags/` | nginx |

À chaque modification, le panel réécrit tous les `site-*.yml` à partir de `sites.json`
et supprime ceux qui ne correspondent plus à aucun site. Les autres fichiers de
`traefik/dynamic/` ne sont jamais touchés. Les écritures sont atomiques
(fichier temporaire puis renommage), Traefik ne lit jamais un fichier à moitié écrit.

Les routes du panel ont une priorité de 100, plus haute que celles des labels Docker :
un site peut donc être repris par le panel avant d'avoir retiré ses labels.

Les sous-domaines `admin`, `auth`, `hub` et `www` sont réservés (gérés en labels).

## Sécurité

- Accès protégé par le portier (`middlewares=portier@docker`).
- Les actions (POST/PUT/DELETE) exigent l'en-tête `Origin: https://admin.wireredblue.xyz` :
  un autre sous-domaine ne peut pas déclencher d'action avec ta session (CSRF).
- Tout ce qui finit dans un fichier Traefik est validé par regex, puis écrit avec une
  bibliothèque YAML : impossible d'injecter une autre règle.
- Le conteneur tourne en uid 1000, sans socket Docker.

## Déploiement

```bash
cd ~/infra && git pull
mkdir -p ~/infra/admin/data ~/infra/maintenance/flags   # avant le premier lancement, pour qu'ils t'appartiennent
cd ~/infra/admin && docker compose up -d --build
```

## Dev local

```bash
cp .env.example .env
npm install
npm run dev
```

## Sauvegarde

Tout l'état tient dans `admin/data/sites.json` : les fichiers Traefik se régénèrent
à partir de lui à la prochaine modification.
