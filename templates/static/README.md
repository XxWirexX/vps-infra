# __PROJECT_NAME__

Site statique servi par nginx sur https://__PROJECT_HOST__

- Le contenu est dans `public/`.
- Chaque push sur `main` redéploie le site automatiquement.
- Pour passer à un générateur (Astro…), ajoute une étape de build dans le `Dockerfile`
  qui produit le dossier servi par nginx.
