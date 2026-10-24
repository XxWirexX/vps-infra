#!/usr/bin/env python3
"""
Agent du serveur : exécute une liste fixe d'actions pour le panel admin.

Le panel (exposé sur le web, derrière le portier) n'a aucun accès à Docker ni au
système. Quand il a besoin de créer un projet, il le demande à cet agent par un
socket Unix local, accessible uniquement à l'utilisateur debian. L'agent n'accepte
que les actions définies ici, avec des paramètres validés : jamais de commande libre.

Actions :
  GET  /health          état de l'agent
  GET  /templates       modèles de projet disponibles
  POST /projects        crée un projet à partir d'un modèle (tâche en arrière-plan) -> { job }
  POST /imports         importe un repo GitHub existant (tâche en arrière-plan) -> { job }
  GET  /jobs/<id>       avancement d'une tâche (journal, résultat)

Aucune dépendance : bibliothèque standard de Python uniquement.
Configuration par variables d'environnement (voir agent/.env.example).
"""

from __future__ import annotations

import http.server
import json
import os
import re
import secrets
import shutil
import socketserver
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path

# ── Configuration ─────────────────────────────────────────────────────────────

def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()

INFRA_DIR = Path(env("INFRA_DIR", "/home/debian/infra"))
PROJECTS_DIR = Path(env("PROJECTS_DIR", "/home/debian/projects"))
SSH_DIR = Path(env("SSH_DIR", "/home/debian/.ssh"))
SOCKET_PATH = Path(env("AGENT_SOCKET", str(INFRA_DIR / "agent/run/agent.sock")))
TEMPLATES_DIR = INFRA_DIR / "templates"
DEPLOY_SCRIPT = INFRA_DIR / "deploy/deploy.sh"

DOMAIN = env("DOMAIN", "wireredblue.xyz")
GH_OWNER = env("GH_OWNER", "XxWirexX")
GH_TOKEN = env("GH_TOKEN")
VPS_HOST = env("VPS_HOST", DOMAIN)
VPS_USER = env("VPS_USER", "debian")
GIT_NAME = env("GIT_NAME", "Agent wireredblue")
GIT_EMAIL = env("GIT_EMAIL", "agent@wireredblue.xyz")

# En dry-run, tout ce qui touche GitHub ou Docker est affiché mais pas exécuté.
DRY_RUN = env("AGENT_DRY_RUN") == "1"

ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$")
SUBDOMAIN_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
SECRET_RE = re.compile(r"__SECRET_([A-Z0-9_]+)__")


class AgentError(Exception):
    """Erreur attendue, dont le message est montré tel quel dans le panel."""


# ── Modèles ───────────────────────────────────────────────────────────────────

def list_templates() -> list[dict]:
    templates = []
    for path in sorted(TEMPLATES_DIR.iterdir()) if TEMPLATES_DIR.is_dir() else []:
        meta_file = path / "template.json"
        if path.name.startswith("_") or not meta_file.is_file():
            continue
        meta = json.loads(meta_file.read_text("utf-8"))
        templates.append({
            "id": path.name,
            "label": meta.get("label", path.name),
            "description": meta.get("description", ""),
            "port": int(meta.get("port") or 0),
            # customPort : le port est choisi dans le formulaire (modèle « Autre stack »)
            "customPort": bool(meta.get("customPort", False)),
            # web = false : pas de sous-domaine ni de route (bot, worker, script…)
            "web": bool(meta.get("web", True)),
            "order": int(meta.get("order", 0)),
        })
    # Les modèles génériques (programme, autre stack) en dernier
    return sorted(templates, key=lambda t: (t["order"], t["label"]))


def render_text(text: str, values: dict[str, str]) -> str:
    for key, value in values.items():
        text = text.replace(key, value)
    return text


def render_tree(root: Path, values: dict[str, str]) -> None:
    """Remplace les marqueurs __PROJECT_*__ dans tous les fichiers texte du projet."""
    for path in root.rglob("*"):
        if not path.is_file() or ".git" in path.parts:
            continue
        try:
            text = path.read_text("utf-8")
        except UnicodeDecodeError:
            continue  # fichier binaire : on n'y touche pas
        rendered = render_text(text, values)
        if rendered != text:
            path.write_text(rendered, "utf-8")


def write_env(root: Path) -> list[str]:
    """
    Crée le .env du serveur à partir du .env.example : chaque __SECRET_NOM__
    devient une valeur aléatoire (la même pour un même NOM).
    Le .env.example commité garde un texte explicite à la place du secret.
    Renvoie la liste des noms de secrets générés (jamais leurs valeurs).
    """
    example = root / ".env.example"
    if not example.is_file():
        return []
    text = example.read_text("utf-8")
    generated: dict[str, str] = {}

    def secret_for(match: re.Match) -> str:
        name = match.group(1)
        if name not in generated:
            generated[name] = secrets.token_hex(24)
        return generated[name]

    env_file = root / ".env"
    env_file.write_text(SECRET_RE.sub(secret_for, text), "utf-8")
    env_file.chmod(0o600)
    example.write_text(SECRET_RE.sub("a-generer", text), "utf-8")
    return sorted(generated)


# ── Tâches ────────────────────────────────────────────────────────────────────

class Job:
    def __init__(self, project: str):
        self.id = uuid.uuid4().hex[:12]
        self.project = project
        self.status = "running"
        self.log: list[str] = []
        self.result: dict | None = None
        self.error: str | None = None
        self.started = time.time()
        self.lock = threading.Lock()

    def write(self, line: str) -> None:
        with self.lock:
            self.log.append(line.rstrip("\n"))
            del self.log[:-2000]

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "id": self.id,
                "project": self.project,
                "status": self.status,
                "log": list(self.log),
                "result": self.result,
                "error": self.error,
            }


JOBS: dict[str, Job] = {}
CREATE_LOCK = threading.Lock()  # une seule création de projet à la fois


def run(job: Job, cmd: list[str], *, cwd: Path | None = None, stdin: str | None = None,
        extra_env: dict[str, str] | None = None, external: bool = False, show: str | None = None) -> str:
    """
    Lance une commande (liste d'arguments, jamais de shell) et recopie sa sortie
    dans le journal. `external=True` marque une commande qui touche GitHub ou Docker :
    elle est sautée en dry-run. `show` remplace l'affichage de la commande
    (pour ne jamais écrire de secret dans le journal).
    """
    job.write(f"$ {show or ' '.join(cmd)}")
    if external and DRY_RUN:
        job.write("  (dry-run : non exécuté)")
        return ""
    proc_env = {**os.environ, **(extra_env or {})}
    proc = subprocess.Popen(
        cmd, cwd=cwd, env=proc_env, text=True,
        stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    if stdin is not None:
        proc.stdin.write(stdin)
        proc.stdin.close()
    output = []
    for line in proc.stdout:
        output.append(line)
        job.write(f"  {line}")
    code = proc.wait()
    if code != 0:
        raise AgentError(f"La commande a échoué (code {code}) : {show or cmd[0]}")
    return "".join(output)


def gh_env() -> dict[str, str]:
    return {"GH_TOKEN": GH_TOKEN, "GH_PROMPT_DISABLED": "1"}


GIT_AS_AGENT = ["git", "-c", f"user.name={GIT_NAME}", "-c", f"user.email={GIT_EMAIL}"]
# Authentification HTTPS par le token, sans jamais l'écrire dans une commande ni un fichier
GIT_TOKEN_AUTH = ["-c", "credential.helper=",
                  "-c", 'credential.helper=!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f']


def require_token() -> None:
    if not DRY_RUN and not GH_TOKEN:
        raise AgentError("GH_TOKEN n'est pas configuré dans agent/.env.")


def setup_keys(job: Job, repo: str, project_id: str, done: list[str]) -> Path:
    """Deploy key (lecture seule) du serveur + clé restreinte de GitHub Actions et ses secrets."""
    job.write("▶ Clé de lecture du serveur")
    key_dir = SSH_DIR / "deploy"
    key_dir.mkdir(parents=True, exist_ok=True)
    key_dir.chmod(0o700)
    deploy_key = key_dir / project_id
    for old in (deploy_key, deploy_key.with_suffix(".pub")):
        old.unlink(missing_ok=True)
    run(job, ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", f"vps-deploy-{project_id}", "-f", str(deploy_key)])
    run(job, ["gh", "repo", "deploy-key", "add", f"{deploy_key}.pub", "-R", repo, "--title", "VPS (lecture seule)"],
        extra_env=gh_env(), external=True)
    done.append(f"deploy key {deploy_key}")

    job.write("▶ Clé de déploiement pour GitHub Actions")
    with tempfile.TemporaryDirectory() as tmp:
        actions_key = Path(tmp) / "key"
        run(job, ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", f"github-actions-{project_id}", "-f", str(actions_key)])
        public = Path(f"{actions_key}.pub").read_text("utf-8").strip()
        line = f'command="{DEPLOY_SCRIPT} {project_id}",restrict {public}'
        authorized = SSH_DIR / "authorized_keys"
        with authorized.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
        authorized.chmod(0o600)
        job.write(f"  authorized_keys : command=\"{DEPLOY_SCRIPT} {project_id}\",restrict …")
        done.append(f"ligne github-actions-{project_id} dans authorized_keys")
        (key_dir / f"{project_id}-actions.pub").write_text(public + "\n", "utf-8")
        run(job, ["gh", "secret", "set", "VPS_SSH_KEY", "-R", repo],
            stdin=actions_key.read_text("utf-8"), extra_env=gh_env(), external=True)
    # La clé privée n'existe plus que dans les secrets GitHub (le dossier temporaire est supprimé).
    run(job, ["gh", "secret", "set", "VPS_HOST", "-R", repo, "--body", VPS_HOST], extra_env=gh_env(), external=True)
    run(job, ["gh", "secret", "set", "VPS_USER", "-R", repo, "--body", VPS_USER], extra_env=gh_env(), external=True)
    return deploy_key


def use_deploy_key(job: Job, project_dir: Path, repo: str, deploy_key: Path, branch: str) -> None:
    """Le serveur récupère ensuite le code en SSH, avec sa deploy key en lecture seule."""
    if _has_remote(project_dir):
        run(job, ["git", "remote", "remove", "origin"], cwd=project_dir)
    run(job, ["git", "remote", "add", "origin", f"git@github.com:{repo}.git"], cwd=project_dir)
    run(job, ["git", "config", "core.sshCommand",
              f"ssh -F /dev/null -i {deploy_key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"],
        cwd=project_dir)
    run(job, ["git", "fetch", "-q", "origin"], cwd=project_dir, external=True)
    run(job, ["git", "branch", "-q", f"--set-upstream-to=origin/{branch}", branch], cwd=project_dir, external=True)


def _has_remote(project_dir: Path) -> bool:
    out = subprocess.run(["git", "remote"], cwd=project_dir, capture_output=True, text=True).stdout.split()
    return "origin" in out


def first_deploy(job: Job, project_id: str) -> str | None:
    """
    Premier déploiement. Un échec ici n'annule rien : le repo, les clés et la CD sont en place,
    il suffit de corriger le projet et de pousser. Renvoie un avertissement, ou None.
    """
    job.write("▶ Premier déploiement")
    try:
        run(job, [str(DEPLOY_SCRIPT), project_id], external=True)
        return None
    except AgentError:
        warning = ("Le premier déploiement a échoué (voir le journal). Tout le reste est en place : "
                   "corrige le Dockerfile ou le docker-compose.yml du repo et pousse, la CD redéploiera.")
        job.write(f"⚠ {warning}")
        return warning


def host_for(subdomain: str | None) -> str | None:
    if subdomain is None:
        return None
    return f"{subdomain}.{DOMAIN}" if subdomain else DOMAIN


def fail(job: Job, err: Exception, done: list[str]) -> None:
    message = str(err) if isinstance(err, AgentError) else f"Erreur inattendue : {err}"
    job.write(f"✖ {message}")
    if done:
        job.write("  Déjà créé, à nettoyer avant de réessayer :")
        for item in done:
            job.write(f"   - {item}")
    job.error = message
    job.status = "failed"


# ── Création à partir d'un modèle ─────────────────────────────────────────────

def create_project(job: Job, project_id: str, name: str, template: str, subdomain: str | None, port: int) -> None:
    repo = f"{GH_OWNER}/{project_id}"
    host = host_for(subdomain)  # None = projet sans web (aucune route)
    project_dir = PROJECTS_DIR / project_id
    done: list[str] = []

    try:
        where = f" sur https://{host}" if host else " (sans web)"
        job.write(f"▶ Création de {name} ({template}){where}")
        if DRY_RUN:
            job.write("  Mode dry-run : GitHub et Docker ne seront pas touchés.")

        # 1. Vérifications
        if project_dir.exists():
            raise AgentError(f"Le dossier {project_dir} existe déjà.")
        require_token()
        if not DRY_RUN:
            check = subprocess.run(["gh", "repo", "view", repo, "--json", "name"],
                                   env={**os.environ, **gh_env()}, capture_output=True, text=True)
            if check.returncode == 0:
                raise AgentError(f"Le repo {repo} existe déjà sur GitHub.")

        # 2. Copie du modèle
        job.write("▶ Copie du modèle")
        shutil.copytree(TEMPLATES_DIR / "_common", project_dir)
        shutil.copytree(TEMPLATES_DIR / template, project_dir, dirs_exist_ok=True)
        (project_dir / "template.json").unlink(missing_ok=True)
        done.append(f"dossier {project_dir}")
        render_tree(project_dir, {
            "__PROJECT_ID__": project_id,
            "__PROJECT_NAME__": name,
            "__PROJECT_HOST__": host or "",
            "__PROJECT_PORT__": str(port),
            "__PROJECT_BRANCH__": "main",
        })
        generated = write_env(project_dir)
        if generated:
            job.write(f"  .env créé, secrets générés : {', '.join(generated)}")

        # 3. Premier commit ([skip ci] : c'est l'agent qui fait le premier déploiement)
        job.write("▶ Premier commit")
        run(job, ["git", "init", "-q", "-b", "main"], cwd=project_dir)
        run(job, ["git", "add", "-A"], cwd=project_dir)
        run(job, GIT_AS_AGENT + ["commit", "-q", "-m", f"Création depuis le modèle {template} [skip ci]"], cwd=project_dir)

        # 4. Repo GitHub privé
        job.write("▶ Repo GitHub")
        run(job, ["gh", "repo", "create", repo, "--private", "--description", name],
            extra_env=gh_env(), external=True)
        if not DRY_RUN:
            done.append(f"repo https://github.com/{repo}")

        # 5-6. Clés et secrets
        deploy_key = setup_keys(job, repo, project_id, done)

        # 7. Push initial (HTTPS + token), puis remote SSH avec la deploy key
        job.write("▶ Envoi du code")
        run(job, ["git", *GIT_TOKEN_AUTH, "push", "-q", f"https://github.com/{repo}.git", "main"],
            cwd=project_dir, extra_env=gh_env(), external=True,
            show=f"git push https://github.com/{repo}.git main")
        use_deploy_key(job, project_dir, repo, deploy_key, "main")

        # 8. Premier déploiement
        warning = first_deploy(job, project_id)

        job.result = {
            "repo": f"https://github.com/{repo}",
            "clone": f"git clone git@github.com:{repo}.git",
            "host": host,
            "warning": warning,
        }
        job.write(f"✔ {name} est prêt" + (f" : https://{host}" if host else ""))
        job.status = "done"
    except Exception as err:  # noqa: BLE001 — tout échec doit finir dans le journal
        fail(job, err, done)
    finally:
        CREATE_LOCK.release()


# ── Import d'un repo existant ──────────────────────────────────────────────────

IMPORT_DIR = TEMPLATES_DIR / "_import"
REPO_RE = re.compile(r"^(?:([A-Za-z0-9-]{1,39})/)?([A-Za-z0-9._-]{1,100})$")

KIND_LABELS = {
    "compose": "docker-compose.yml déjà présent",
    "dockerfile": "Dockerfile déjà présent",
    "nuxt": "Nuxt",
    "node": "Node.js (npm run build, npm start)",
    "spa": "site Vite / Astro (build statique servi par nginx)",
    "static": "site HTML statique",
    "python": "Python",
    "unknown": "type inconnu (compose de démo)",
}
# Port par défaut de l'application, selon le type détecté
KIND_PORTS = {"nuxt": 3000, "node": 3000, "spa": 80, "static": 80, "python": 8000}
COMPOSE_NAMES = ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")


def detect_kind(root: Path) -> tuple[str, str | None]:
    """Devine le type de projet. Renvoie (type, fichier Python principal éventuel)."""
    if any((root / n).is_file() for n in COMPOSE_NAMES):
        return "compose", None
    if (root / "Dockerfile").is_file():
        return "dockerfile", None
    pkg_file = root / "package.json"
    if pkg_file.is_file():
        try:
            pkg = json.loads(pkg_file.read_text("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            pkg = {}
        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        scripts = pkg.get("scripts", {}) or {}
        if "nuxt" in deps:
            return "nuxt", None
        if "astro" in deps:
            return "spa", None
        if "vite" in deps and "start" not in scripts:
            return "spa", None
        return "node", None
    if (root / "requirements.txt").is_file() or (root / "pyproject.toml").is_file():
        for main in ("main.py", "app.py", "bot.py", "run.py"):
            if (root / main).is_file():
                return "python", main
        return "python", "main.py"
    if (root / "index.html").is_file():
        return "static", None
    return "unknown", None


def exposed_port(root: Path) -> int | None:
    """Port déclaré par EXPOSE dans le Dockerfile du repo, s'il y en a un."""
    dockerfile = root / "Dockerfile"
    if not dockerfile.is_file():
        return None
    match = re.search(r"^\s*EXPOSE\s+(\d{1,5})", dockerfile.read_text("utf-8", errors="ignore"), re.M | re.I)
    return int(match.group(1)) if match and 0 < int(match.group(1)) < 65536 else None


def compose_for(project_id: str, web: bool, demo: bool) -> str:
    lines = [
        "# Ajouté par le panel admin pour le déploiement sur le VPS. Adapte-le si besoin.",
        "services:",
        "  app:",
    ]
    if demo:
        lines += [
            "    # Conteneur de démo : remplace-le par ton programme (build: . + un Dockerfile).",
            "    image: alpine:3.20",
            '    command: ["sh", "-c", "echo \'Remplace ce service dans docker-compose.yml\'; exec sleep infinity"]',
        ]
    else:
        lines.append("    build: .")
    lines += [
        f"    container_name: {project_id}",
        "    restart: unless-stopped",
        "    env_file:",
        "      - path: .env",
        "        required: false",
    ]
    if web:
        lines += ["    networks:", "      - proxy", "", "networks:", "  proxy:", "    external: true"]
    return "\n".join(lines) + "\n"


def add_missing_files(job: Job, root: Path, project_id: str, kind: str, web: bool,
                      branch: str, python_main: str | None) -> list[str]:
    """Ajoute uniquement ce qui manque pour le déploiement. Ne remplace jamais un fichier existant."""
    added: list[str] = []

    def put(rel: str, content: str) -> None:
        target = root / rel
        if target.exists():
            job.write(f"  {rel} existe déjà, conservé tel quel")
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, "utf-8")
        added.append(rel)
        job.write(f"  + {rel}")

    # Workflow de déploiement
    workflow = (TEMPLATES_DIR / "_common/.github/workflows/deploy.yml").read_text("utf-8")
    workflow = render_text(workflow, {"__PROJECT_ID__": project_id, "__PROJECT_BRANCH__": branch})
    if (root / ".github/workflows/deploy.yml").exists():
        put(".github/workflows/deploy-vps.yml", workflow)
    else:
        put(".github/workflows/deploy.yml", workflow)

    # Dockerfile selon le type détecté
    if kind in ("nuxt", "node", "spa", "static", "python"):
        for f in sorted((IMPORT_DIR / kind).iterdir()):
            text = f.read_text("utf-8")
            if python_main:
                text = text.replace("__PYTHON_MAIN__", python_main)
            put(f.name, text)

    # Compose, sauf si le repo en a déjà un
    if kind != "compose":
        put("docker-compose.yml", compose_for(project_id, web, demo=(kind == "unknown")))
    return added


def import_project(job: Job, source: str, project_id: str, name: str,
                   subdomain: str | None, port: int | None) -> None:
    host = host_for(subdomain)
    project_dir = PROJECTS_DIR / project_id
    done: list[str] = []
    try:
        job.write(f"▶ Import de {source}" + (f" sur https://{host}" if host else " (sans web)"))
        if DRY_RUN:
            job.write("  Mode dry-run : GitHub et Docker ne seront pas touchés.")
        if project_dir.exists():
            raise AgentError(f"Le dossier {project_dir} existe déjà.")
        require_token()

        # 1. Le repo existe ? Quelle est sa branche principale ?
        job.write("▶ Repo GitHub")
        branch = "main"
        if not DRY_RUN:
            info = subprocess.run(["gh", "repo", "view", source, "--json", "nameWithOwner,defaultBranchRef"],
                                  env={**os.environ, **gh_env()}, capture_output=True, text=True)
            if info.returncode != 0:
                raise AgentError(f"Repo {source} introuvable, ou le token n'y a pas accès.")
            data = json.loads(info.stdout)
            source = data["nameWithOwner"]
            branch = (data.get("defaultBranchRef") or {}).get("name") or "main"
        job.write(f"  {source}, branche {branch}")

        # 2. Clone
        job.write("▶ Récupération du code")
        if DRY_RUN:
            project_dir.mkdir(parents=True)
            run(job, ["git", "init", "-q", "-b", branch], cwd=project_dir)
            job.write(f"  (dry-run : dossier vide à la place du clone de {source})")
        else:
            run(job, ["git", *GIT_TOKEN_AUTH, "clone", "-q", "--branch", branch,
                      f"https://github.com/{source}.git", str(project_dir)],
                extra_env=gh_env(), show=f"git clone https://github.com/{source}.git {project_dir}")
        done.append(f"dossier {project_dir}")

        # 3. Détection et fichiers manquants
        kind, python_main = detect_kind(project_dir)
        job.write(f"▶ Type détecté : {KIND_LABELS[kind]}")
        web = host is not None
        added = add_missing_files(job, project_dir, project_id, kind, web, branch, python_main)
        if kind in ("compose", "dockerfile") and web:
            job.write(f"  Vérifie que ton compose nomme le conteneur « {project_id} » et le branche sur le réseau proxy.")
        example = project_dir / ".env.example"
        if example.is_file() and not (project_dir / ".env").exists():
            shutil.copy(example, project_dir / ".env")
            (project_dir / ".env").chmod(0o600)
            job.write(f"  .env créé depuis .env.example : remplis les valeurs dans {project_dir}/.env")

        if added:
            run(job, ["git", "add", "--", *added], cwd=project_dir)
            run(job, GIT_AS_AGENT + ["commit", "-q", "-m", "Ajout du déploiement sur le VPS [skip ci]"], cwd=project_dir)

        # 4. Clés, secrets, push, remote SSH
        deploy_key = setup_keys(job, source, project_id, done)
        if added:
            job.write("▶ Envoi des fichiers ajoutés")
            run(job, ["git", *GIT_TOKEN_AUTH, "push", "-q", f"https://github.com/{source}.git", branch],
                cwd=project_dir, extra_env=gh_env(), external=True,
                show=f"git push https://github.com/{source}.git {branch}")
        use_deploy_key(job, project_dir, source, deploy_key, branch)

        # 5. Premier déploiement
        warning = first_deploy(job, project_id)
        app_port = port or KIND_PORTS.get(kind) or exposed_port(project_dir) or 80

        job.result = {
            "repo": f"https://github.com/{source}",
            "clone": f"git clone git@github.com:{source}.git",
            "added": added,
            "host": host,
            "warning": warning,
            "kind": kind,
            "route": {"container": project_id, "port": app_port} if web else None,
        }
        job.write(f"✔ {name} est importé" + (f" : https://{host} → {project_id}:{app_port}" if host else ""))
        job.status = "done"
    except Exception as err:  # noqa: BLE001
        fail(job, err, done)
    finally:
        CREATE_LOCK.release()


# ── Validation des demandes ───────────────────────────────────────────────────

def parse_common(body: dict) -> tuple[str, str]:
    project_id = str(body.get("id", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    if not ID_RE.match(project_id):
        raise AgentError("Identifiant invalide.")
    if not name or len(name) > 60 or any(c in name for c in "\r\n\0"):
        raise AgentError("Nom invalide.")
    return project_id, name


def parse_subdomain(body: dict, web: bool) -> str | None:
    if not web:
        return None
    subdomain = str(body.get("subdomain", "")).strip().lower()
    if subdomain and not SUBDOMAIN_RE.match(subdomain):
        raise AgentError("Sous-domaine invalide.")
    return subdomain


def parse_port(value) -> int | None:
    if value in (None, "", 0):
        return None
    try:
        port = int(value)
    except (TypeError, ValueError):
        raise AgentError("Port invalide.") from None
    if not 1 <= port <= 65535:
        raise AgentError("Port invalide.")
    return port


def launch(target, job_id_project: str, *args) -> Job:
    if not CREATE_LOCK.acquire(blocking=False):
        raise AgentError("Une création de projet est déjà en cours, réessaie dans un instant.")
    job = Job(job_id_project)
    JOBS[job.id] = job
    threading.Thread(target=target, args=(job, *args), daemon=True).start()
    return job


def start_create(body: dict) -> Job:
    project_id, name = parse_common(body)
    template = str(body.get("template", "")).strip()
    meta = next((t for t in list_templates() if t["id"] == template), None)
    if meta is None:
        raise AgentError("Modèle inconnu.")
    subdomain = parse_subdomain(body, meta["web"])
    port = (parse_port(body.get("port")) if meta.get("customPort") else None) or meta["port"] or 80
    return launch(create_project, project_id, project_id, name, template, subdomain, port)


def start_import(body: dict) -> Job:
    project_id, name = parse_common(body)
    match = REPO_RE.match(str(body.get("repo", "")).strip())
    if not match:
        raise AgentError("Repo invalide : nom-du-repo ou proprietaire/nom-du-repo.")
    source = f"{match.group(1) or GH_OWNER}/{match.group(2)}"
    subdomain = parse_subdomain(body, bool(body.get("web", True)))
    port = parse_port(body.get("port"))
    return launch(import_project, project_id, source, project_id, name, subdomain, port)


# ── Serveur HTTP sur socket Unix ──────────────────────────────────────────────

class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "wireredblue-agent"

    def address_string(self) -> str:  # pas d'adresse IP sur un socket Unix
        return "local"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[agent] {self.command} {self.path} {fmt % args}", flush=True)

    def send_json(self, status: int, data) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path == "/health":
            return self.send_json(200, {"ok": True, "dryRun": DRY_RUN})
        if self.path == "/templates":
            return self.send_json(200, list_templates())
        match = re.fullmatch(r"/jobs/([a-f0-9]{12})", self.path)
        if match and match.group(1) in JOBS:
            return self.send_json(200, JOBS[match.group(1)].snapshot())
        self.send_json(404, {"error": "Introuvable."})

    def do_POST(self) -> None:
        actions = {"/projects": start_create, "/imports": start_import}
        if self.path not in actions:
            return self.send_json(404, {"error": "Introuvable."})
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 10_000)
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise AgentError("Corps JSON attendu.")
            job = actions[self.path](body)
        except (AgentError, json.JSONDecodeError, ValueError) as err:
            return self.send_json(400, {"error": str(err)})
        self.send_json(202, {"job": job.id})


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True


def main() -> None:
    SOCKET_PATH.parent.mkdir(parents=True, exist_ok=True)
    SOCKET_PATH.parent.chmod(0o700)
    SOCKET_PATH.unlink(missing_ok=True)
    with Server(str(SOCKET_PATH), Handler) as server:
        SOCKET_PATH.chmod(0o660)
        mode = "dry-run" if DRY_RUN else "normal"
        print(f"[agent] en écoute sur {SOCKET_PATH} (mode {mode})", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
