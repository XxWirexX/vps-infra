# __PROJECT_NAME__

En ligne sur https://__PROJECT_HOST__ (le panel envoie le trafic vers le conteneur `__PROJECT_ID__`, port `__PROJECT_PORT__`).

Pour l'instant, `docker-compose.yml` lance un conteneur de démo. Pour mettre ton application :

1. Ajoute un `Dockerfile` à la racine
2. Dans `docker-compose.yml`, remplace `image:` et `command:` par `build: .`
3. Garde `container_name: __PROJECT_ID__` et le réseau `proxy`
4. Ton application doit écouter sur `0.0.0.0:__PROJECT_PORT__` (sinon change le port dans le panel)
5. Push sur `main` : la CD reconstruit et relance

Les secrets vont dans le `.env` du serveur (`~/projects/__PROJECT_ID__/.env`), jamais dans le repo.

Des exemples de Dockerfile (Nuxt, Node, Vite/Astro, Python, HTML) sont dans `vps-infra/templates/_import/`.
