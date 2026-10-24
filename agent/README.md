# Agent du serveur

Petit service Python (bibliothèque standard uniquement) qui exécute, pour le panel admin,
une liste fixe d'actions : aujourd'hui, **créer un projet** à partir d'un modèle de `templates/`.

Le panel est exposé sur le web (derrière le portier) et n'a volontairement aucun accès à
Docker ni à GitHub. Il demande à l'agent par un **socket Unix** (`agent/run/agent.sock`),
accessible uniquement à l'utilisateur `debian`. L'agent valide chaque paramètre et n'exécute
jamais de commande libre.

## Ce que fait « Nouveau projet »

1. Copie `templates/_common` puis le modèle choisi dans `~/projects/<id>`, remplace les marqueurs
2. Génère le `.env` (mots de passe aléatoires), jamais commité
3. Premier commit, marqué `[skip ci]`
4. Crée le repo **privé** `XxWirexX/<id>` sur GitHub
5. Ajoute une **deploy key en lecture seule** (`~/.ssh/deploy/<id>`) pour que le serveur puisse `git pull`
6. Crée la clé de **GitHub Actions**, restreinte dans `authorized_keys` à
   `command="/home/debian/infra/deploy/deploy.sh <id>",restrict` : elle ne peut que redéployer ce projet.
   Sa clé privée part dans les secrets du repo (`VPS_SSH_KEY`, avec `VPS_HOST` et `VPS_USER`), puis est effacée du serveur.
7. Pousse le code, configure le remote SSH avec la deploy key
8. Lance le premier déploiement (`deploy/deploy.sh <id>`)

De son côté, le panel crée la route `site-<id>.yml` vers le conteneur `<id>`, sauf pour le modèle
**Programme (sans web)** : pas de sous-domaine, il démarre avec un compose de démo à remplacer.
Ensuite, chaque push sur `main` redéploie le projet tout seul.

## Importer un repo existant

Onglet **Importer un repo GitHub** du panel : pour un projet qui existe déjà sur GitHub
(`nom-du-repo` pour un repo de `XxWirexX`, ou `proprietaire/nom-du-repo`).

1. Clone le repo dans `~/projects/<id>`, sur sa branche principale (pas forcément `main`)
2. Devine son type et ajoute **seulement ce qui manque** (jamais de fichier remplacé) :
   Dockerfile et `.dockerignore` (voir `templates/_import/`), `docker-compose.yml`, workflow de déploiement
   (`deploy-vps.yml` si un `deploy.yml` existe déjà). Ces ajouts sont commités et poussés dans le repo :
   pense à faire un `git pull` sur ton PC.
3. Crée le `.env` du serveur à partir du `.env.example` s'il y en a un (à remplir ensuite)
4. Clés, secrets et premier déploiement, comme pour un nouveau projet
5. Le panel crée la route une fois le port connu : celui du formulaire, sinon celui du type détecté,
   sinon l'`EXPOSE` du Dockerfile

Si le repo a déjà son `docker-compose.yml`, il est gardé tel quel : pour qu'il soit joignable,
son conteneur doit s'appeler `<id>` et être sur le réseau `proxy`.

## Déploiement raté

Si le premier déploiement échoue (Dockerfile à adapter, variable manquante dans le `.env`…), le projet
n'est pas annulé : le repo, les clés et la CD sont en place. Corrige le repo et pousse, la CD redéploie.

## Installation

### 1. Le token GitHub

Sur GitHub : **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

- **Repository access** : *All repositories* (les repos des futurs projets n'existent pas encore)
- **Repository permissions** :
  - *Administration* : Read and write (créer le repo, ajouter la deploy key)
  - *Contents* : Read and write (pousser le premier commit)
  - *Secrets* : Read and write (secrets de GitHub Actions)
  - *Workflows* : Read and write (pousser `.github/workflows/deploy.yml`)
  - *Metadata* : Read-only (ajouté automatiquement)
- **Expiration** : un an, et note-toi la date pour le renouveler

Ce token est puissant : il ne vit que dans `agent/.env` sur le serveur, lisible par `debian` seulement.
Il ne permet pas de supprimer des repos.

### 2. Sur le VPS

```bash
sudo apt install -y gh            # CLI GitHub, utilisée par l'agent
cd ~/infra && git pull

cp agent/.env.example agent/.env
chmod 600 agent/.env
nano agent/.env                   # GH_TOKEN, GIT_EMAIL ; garde AGENT_DRY_RUN=1 pour le premier essai

sudo cp agent/agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agent
systemctl status agent            # doit afficher "en écoute sur …/agent.sock (mode dry-run)"
```

Puis recrée le panel, **après** l'agent (le dossier du socket doit déjà exister et t'appartenir) :

```bash
cd ~/infra/admin && docker compose up -d --build
```

### 3. Premier essai

1. En dry-run, crée un projet depuis le panel : le journal doit aller jusqu'au bout, rien n'est créé sur GitHub.
   Nettoie ensuite : supprime le site dans le panel, puis
   `rm -rf ~/projects/<id> ~/.ssh/deploy/<id>*` et la ligne `github-actions-<id>` de `~/.ssh/authorized_keys`.
2. Passe `AGENT_DRY_RUN=0` dans `agent/.env`, puis `sudo systemctl restart agent`.
3. Crée un vrai projet de test avec le modèle **Site statique** : le site doit répondre, et un push depuis ton PC doit le redéployer.

## Logs

```bash
journalctl -u agent -f
```

## Supprimer un projet

Panel → section **Projets sur le serveur** → **Supprimer** (il faut retaper l'identifiant pour confirmer).
L'agent :

1. arrête et supprime les conteneurs et les images construites (`docker compose down --rmi local`),
   et les volumes **seulement si** la case « Supprimer aussi les données » est cochée ;
2. retire côté GitHub la clé de déploiement « VPS (lecture seule) » et les secrets `VPS_*`
   (**le repo est conservé**, à supprimer à la main sur GitHub si besoin) ;
3. retire la ligne `github-actions-<id>` de `authorized_keys` et les clés de `~/.ssh/deploy/` ;
4. supprime `~/projects/<id>`.

Le panel retire tout de suite les routes qui pointaient vers le projet. Si des fichiers créés par
un conteneur en root restent, le journal donne la commande `sudo rm -rf` à lancer.
