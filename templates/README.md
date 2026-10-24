# Modèles de projet

Utilisés par l'agent (`agent/agent.py`) quand on crée un projet depuis le panel.

Chaque projet reçoit d'abord le contenu de `_common/` (workflow de déploiement),
puis celui de son modèle. Dans tous les fichiers, l'agent remplace :

| Marqueur | Valeur |
|---|---|
| `__PROJECT_ID__` | l'identifiant (nom du repo, du dossier et du conteneur) |
| `__PROJECT_NAME__` | le nom affiché |
| `__PROJECT_HOST__` | le domaine complet, ex. `blog.wireredblue.xyz` |

Dans `.env.example`, chaque `__SECRET_<NOM>__` devient une valeur aléatoire dans le `.env`
du serveur (le même nom donne la même valeur partout dans le fichier). Le `.env.example`
commité garde un texte à la place.

`template.json` décrit le modèle pour le panel : nom, description, port de l'application,
et `"web": false` pour un programme sans interface web (pas de sous-domaine ni de route).

Pour un modèle web, le conteneur exposé doit s'appeler `__PROJECT_ID__` et être sur le réseau `proxy`.
Pour `program/`, `__PROJECT_HOST__` est remplacé par une chaîne vide.

Modèles génériques : `program/` (sans web) et `custom/` (« Autre stack », port choisi dans le panel,
remplacé par `__PROJECT_PORT__`). `order` dans `template.json` les range en fin de liste.

`_import/` contient les Dockerfiles ajoutés à l'import d'un repo existant (voir `_import/README.md`).
