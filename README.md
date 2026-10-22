# Infra wireredblue.xyz

VPS OVH, Debian 13, Docker.

## Règles
- Seul Traefik publie des ports (80/443).
- Tous les services passent par le réseau Docker `proxy`.
- Les secrets vont dans des `.env` (jamais commités), avec un `.env.example` à côté.
