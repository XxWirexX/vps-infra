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

`template.json` décrit le modèle pour le panel (nom, description, port de l'application).
Le conteneur exposé doit s'appeler `__PROJECT_ID__` et être sur le réseau `proxy`.
