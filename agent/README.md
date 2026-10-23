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

De son côté, le panel crée la route `site-<id>.yml` vers le conteneur `<id>`.
Ensuite, chaque push sur `main` redéploie le projet tout seul.

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

## Supprimer un projet (à la main pour l'instant)

```bash
cd ~/projects/<id> && docker compose down -v      # -v supprime aussi la base, attention
rm -rf ~/projects/<id> ~/.ssh/deploy/<id>*
nano ~/.ssh/authorized_keys                        # retirer la ligne github-actions-<id>
```

Puis supprime le site dans le panel, et le repo sur GitHub si tu ne le gardes pas.
