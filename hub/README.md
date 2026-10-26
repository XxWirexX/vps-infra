# Hub

`https://hub.wireredblue.xyz` : la page qui liste tous les sites.

En attendant le portfolio, le hub est aussi servi à la **racine** (`https://wireredblue.xyz`) : c'est
cette version qui est indexée par Google (`hub.` est en `noindex`, avec un lien canonique vers la racine).
Dès qu'un site est ajouté à la racine dans le panel, il passe devant automatiquement (priorité 100 contre 50).
`www.wireredblue.xyz` redirige vers la racine (`traefik/dynamic/00-www.yml`).

- **Public** : les sites marqués « Public » dans le panel admin.
- **Une fois connecté au portier** : en plus, les sites « Privé » et les outils (admin, portier).
- Les sites « Masqué » n'apparaissent jamais.
- Un point vert / rouge indique si le conteneur répond (vérifié au plus toutes les 30 s), et un badge
  signale les sites en maintenance.

## Fonctionnement

- La liste vient de `admin/data/sites.json`, monté **en lecture seule** : un site ajouté ou modifié
  dans le panel apparaît au prochain chargement de la page. On choisit sa visibilité et sa description
  dans le formulaire du site (bouton « Modifier »). Par défaut, un site est privé.
- Pour savoir si tu es connecté, le hub transmet tes cookies au portier (`http://portier:3000/verify`),
  exactement comme Traefik le fait pour les sites protégés. Le hub n'a donc aucun secret.
- La page n'est jamais mise en cache (`Cache-Control: private, no-store`), puisqu'elle change selon
  la personne connectée.

## Déploiement

```bash
cd ~/infra && git pull
mkdir -p ~/infra/admin/data      # existe déjà si le panel tourne
cd ~/infra/hub && docker compose up -d --build
```

## Dev local

```bash
npm install
SITES_FILE=../admin/.data/state/sites.json PORTIER_VERIFY_URL=http://localhost:3001/verify npm run dev
```

Le style est dans `public/style.css`, la page dans `src/index.tsx` (JSX de Hono, échappé automatiquement).
