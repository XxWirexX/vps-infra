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
  POST /projects        crée un projet (tâche en arrière-plan) -> { job }
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
            "port": int(meta.get("port", 80)),
        })
    return templates


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


def create_project(job: Job, project_id: str, name: str, template: str, subdomain: str) -> None:
    repo = f"{GH_OWNER}/{project_id}"
    host = f"{subdomain}.{DOMAIN}" if subdomain else DOMAIN
    project_dir = PROJECTS_DIR / project_id
    done: list[str] = []

    try:
        job.write(f"▶ Création de {name} ({template}) sur https://{host}")
        if DRY_RUN:
            job.write("  Mode dry-run : GitHub et Docker ne seront pas touchés.")

        # 1. Vérifications
        if project_dir.exists():
            raise AgentError(f"Le dossier {project_dir} existe déjà.")
        if not DRY_RUN:
            if not GH_TOKEN:
                raise AgentError("GH_TOKEN n'est pas configuré dans agent/.env.")
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
            "__PROJECT_HOST__": host,
        })
        generated = write_env(project_dir)
        if generated:
            job.write(f"  .env créé, secrets générés : {', '.join(generated)}")

        # 3. Premier commit ([skip ci] : c'est l'agent qui fait le premier déploiement)
        job.write("▶ Premier commit")
        git = ["git", "-c", f"user.name={GIT_NAME}", "-c", f"user.email={GIT_EMAIL}"]
        run(job, ["git", "init", "-q", "-b", "main"], cwd=project_dir)
        run(job, ["git", "add", "-A"], cwd=project_dir)
        run(job, git + ["commit", "-q", "-m", f"Création depuis le modèle {template} [skip ci]"], cwd=project_dir)

        # 4. Repo GitHub privé
        job.write("▶ Repo GitHub")
        run(job, ["gh", "repo", "create", repo, "--private", "--description", name],
            extra_env=gh_env(), external=True)
        if not DRY_RUN:
            done.append(f"repo https://github.com/{repo}")

        # 5. Clé de lecture du serveur (deploy key, lecture seule)
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

        # 6. Clé de GitHub Actions, restreinte au déploiement de CE projet
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

        # 7. Push initial (HTTPS + token), puis remote SSH avec la deploy key
        job.write("▶ Envoi du code")
        helper = '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f'
        run(job, ["git", "-c", "credential.helper=", "-c", f"credential.helper={helper}",
                  "push", "-q", f"https://github.com/{repo}.git", "main"],
            cwd=project_dir, extra_env=gh_env(), external=True,
            show=f"git push https://github.com/{repo}.git main")
        run(job, ["git", "remote", "add", "origin", f"git@github.com:{repo}.git"], cwd=project_dir)
        run(job, ["git", "config", "core.sshCommand",
                  f"ssh -F /dev/null -i {deploy_key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"],
            cwd=project_dir)
        run(job, ["git", "fetch", "-q", "origin"], cwd=project_dir, external=True)
        run(job, ["git", "branch", "-q", "--set-upstream-to=origin/main", "main"], cwd=project_dir, external=True)

        # 8. Premier déploiement
        job.write("▶ Premier déploiement")
        run(job, [str(DEPLOY_SCRIPT), project_id], external=True)

        job.result = {
            "repo": f"https://github.com/{repo}",
            "clone": f"git clone git@github.com:{repo}.git",
            "host": host,
        }
        job.write(f"✔ {name} est prêt : https://{host}")
        job.status = "done"
    except Exception as err:  # noqa: BLE001 — tout échec doit finir dans le journal
        message = str(err) if isinstance(err, AgentError) else f"Erreur inattendue : {err}"
        job.write(f"✖ {message}")
        if done:
            job.write("  Déjà créé, à nettoyer avant de réessayer :")
            for item in done:
                job.write(f"   - {item}")
        job.error = message
        job.status = "failed"
    finally:
        CREATE_LOCK.release()


def start_create(body: dict) -> Job:
    project_id = str(body.get("id", "")).strip().lower()
    name = str(body.get("name", "")).strip()
    template = str(body.get("template", "")).strip()
    subdomain = str(body.get("subdomain", "")).strip().lower()

    if not ID_RE.match(project_id):
        raise AgentError("Identifiant invalide.")
    if not name or len(name) > 60 or any(c in name for c in "\r\n\0"):
        raise AgentError("Nom invalide.")
    if template not in {t["id"] for t in list_templates()}:
        raise AgentError("Modèle inconnu.")
    if subdomain and not SUBDOMAIN_RE.match(subdomain):
        raise AgentError("Sous-domaine invalide.")
    if not CREATE_LOCK.acquire(blocking=False):
        raise AgentError("Une création de projet est déjà en cours, réessaie dans un instant.")

    job = Job(project_id)
    JOBS[job.id] = job
    threading.Thread(target=create_project, args=(job, project_id, name, template, subdomain), daemon=True).start()
    return job


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
        if self.path != "/projects":
            return self.send_json(404, {"error": "Introuvable."})
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 10_000)
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise AgentError("Corps JSON attendu.")
            job = start_create(body)
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
