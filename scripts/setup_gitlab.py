#!/usr/bin/env python3
"""
BEST WEATHER — 100% Automated GitLab Setup Wizard
=================================================
Automates 100% of the GitLab backend setup in ~5 seconds via GitLab REST API:
1. Connects with GitLab via Personal Access Token (PAT with 'api' scope)
2. Detects or creates the GitLab project (e.g. username/Wetter_App)
3. Detects the GitLab Pages URL (https://username.gitlab.io/Wetter_App/)
4. Programmatically creates the GitLab OAuth 2.0 PKCE Application (POST /api/v4/user/applications)
   -> Zero manual clicks in GitLab User Settings!
5. Automatically writes clientId and projectId into features/notifications.js (DEFAULT_GITLAB_OAUTH)
6. Configures git remote and pushes to GitLab default branch

Usage:
  python3 scripts/setup_gitlab.py [--token <glpat-...>] [--host <https://gitlab.com>] [--project <name>] [--push]
"""

import sys
import os
import json
import argparse
import subprocess
import urllib.request
import urllib.parse
import urllib.error

DEFAULT_HOST = "https://gitlab.com"
APP_NAME = "Alpen-Wetter Push"
REPO_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NOTIF_JS_PATH = os.path.join(REPO_DIR, "features", "notifications.js")


def gitlab_api_request(url, method="GET", token=None, payload=None):
    headers = {
        "Accept": "application/json"
    }
    if token:
        headers["PRIVATE-TOKEN"] = token.strip()

    data_bytes = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data_bytes = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body) if body.strip() else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            err_json = json.loads(err_body)
        except Exception:
            err_json = {"error": err_body}
        return e.code, err_json
    except Exception as e:
        return 0, {"error": str(e)}


def update_notifications_js(project_id, client_id, host=DEFAULT_HOST):
    if not os.path.exists(NOTIF_JS_PATH):
        raise FileNotFoundError(f"notifications.js nicht gefunden unter: {NOTIF_JS_PATH}")

    with open(NOTIF_JS_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    # Suche nach DEFAULT_GITLAB_OAUTH Block
    target_block = (
        f"export const DEFAULT_GITLAB_OAUTH = {{\n"
        f"  host: '{host}',\n"
        f"  clientId: '{client_id}',\n"
        f"  projectId: '{project_id}'\n"
        f"}};"
    )

    import re
    new_content, count = re.subn(
        r"export const DEFAULT_GITLAB_OAUTH = \{[\s\S]*?\};",
        target_block,
        content
    )

    if count == 0:
        raise ValueError("Konnte DEFAULT_GITLAB_OAUTH in features/notifications.js nicht ersetzen.")

    with open(NOTIF_JS_PATH, "w", encoding="utf-8") as f:
        f.write(new_content)

    print(f"✓ features/notifications.js erfolgreich aktualisiert:")
    print(f"   • Host:      {host}")
    print(f"   • ProjectId: {project_id}")
    print(f"   • ClientId:  {client_id}")


def main():
    parser = argparse.ArgumentParser(description="Best Weather 100% Automated GitLab Setup Wizard")
    parser.add_argument("--token", help="GitLab Personal Access Token mit 'api' Scope (glpat-...)")
    parser.add_argument("--host", default=DEFAULT_HOST, help="GitLab Host (Standard: https://gitlab.com)")
    parser.add_argument("--project", default="Wetter_App", help="Projektname / Repo-Name auf GitLab (Standard: Wetter_App)")
    parser.add_argument("--push", action="store_true", help="Automatisch commiten und via git push nach GitLab übertragen")
    args = parser.parse_args()

    host = args.host.rstrip("/")
    token = args.token or os.environ.get("GITLAB_TOKEN") or os.environ.get("PUSH_STATE_API_TOKEN")

    print("=============================================================================")
    print("🦊 BEST WEATHER — 100% Automatisierter GitLab Setup Wizard")
    print("=============================================================================")

    if not token:
        print("\nHinweis: Für das vollautomatische Setup wird einmalig ein GitLab Personal")
        print("Access Token (PAT) mit 'api' Berechtigung benötigt.")
        print(f"Erstellen unter: {host}/-/user_settings/personal_access_tokens (Scope: api)")
        try:
            token = input("\n🔑 Bitte GitLab Token eingeben (glpat-...): ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nAbgebrochen.")
            sys.exit(1)

    if not token:
        print("❌ Kein Token angegeben. Setup beendet.")
        sys.exit(1)

    # 1. Benutzer abfragen
    print("\n[1/5] Prüfe GitLab Authentifizierung...")
    status, user_data = gitlab_api_request(f"{host}/api/v4/user", token=token)
    if status != 200:
        print(f"❌ Authentifizierung fehlgeschlagen (HTTP {status}): {user_data.get('message', user_data)}")
        sys.exit(1)

    username = user_data.get("username")
    user_id = user_data.get("id")
    print(f"✓ Angemeldet als: @{username} (ID: {user_id})")

    # 2. Projekt suchen oder erstellen
    project_name = args.project
    project_path = f"{username}/{project_name}"
    encoded_path = urllib.parse.quote(project_path, safe="")
    print(f"\n[2/5] Prüfe GitLab Projekt: {project_path}...")
    status, proj_data = gitlab_api_request(f"{host}/api/v4/projects/{encoded_path}", token=token)

    project_id = None
    if status == 200:
        project_id = proj_data.get("id")
        print(f"✓ Projekt existiert bereits (ID: {project_id}, Web: {proj_data.get('web_url')})")
    elif status == 404:
        print(f"ℹ️ Projekt noch nicht vorhanden. Erstelle neues GitLab Projekt '{project_name}'...")
        status, create_data = gitlab_api_request(
            f"{host}/api/v4/projects",
            method="POST",
            token=token,
            payload={
                "name": project_name,
                "path": project_name,
                "visibility": "public",
                "initialize_with_readme": False
            }
        )
        if status not in (200, 201):
            print(f"❌ Konnte Projekt nicht erstellen (HTTP {status}): {create_data}")
            sys.exit(1)
        project_id = create_data.get("id")
        proj_data = create_data
        print(f"✓ Neues Projekt erfolgreich erstellt (ID: {project_id})!")
    else:
        print(f"❌ Fehler bei Projektabfrage (HTTP {status}): {proj_data}")
        sys.exit(1)

    # 3. GitLab Pages URL & Redirect URI berechnen
    # Standard GitLab Pages: https://<username>.gitlab.io/<project_name>/
    # Bei Gruppen/Subgruppen kann GitLab Pages URL leicht abweichen, proj_data liefert oft pages_url
    pages_url = f"https://{username.lower()}.gitlab.io/{project_name}/"
    redirect_uris = [pages_url]
    # Auch localhost für lokale Entwicklung mit aufnehmen
    redirect_uris.append("http://localhost:8000/")
    redirect_uri_str = "\n".join(redirect_uris)

    print(f"\n[3/5] Prüfe/Erstelle GitLab OAuth 2.0 PKCE Application...")
    print(f"   • Redirect URIs: {', '.join(redirect_uris)}")
    print(f"   • Scopes:        api")
    print(f"   • Confidential:  false (Public Client für PKCE)")

    # Bestehende Apps abfragen
    status, apps = gitlab_api_request(f"{host}/api/v4/user/applications", token=token)
    client_id = None

    if status == 200 and isinstance(apps, list):
        for app in apps:
            if app.get("name") == APP_NAME:
                client_id = app.get("application_id")
                print(f"✓ Bestehende OAuth Application gefunden (Client ID: {client_id})")
                break

    if not client_id:
        print(f"ℹ️ Registriere neue OAuth Application '{APP_NAME}' via API...")
        app_payload = {
            "name": APP_NAME,
            "redirect_uri": redirect_uri_str,
            "scopes": "api",
            "confidential": False
        }
        status, new_app = gitlab_api_request(
            f"{host}/api/v4/user/applications",
            method="POST",
            token=token,
            payload=app_payload
        )
        if status not in (200, 201):
            print(f"❌ Konnte OAuth App nicht erstellen (HTTP {status}): {new_app}")
            sys.exit(1)
        client_id = new_app.get("application_id")
        print(f"✓ OAuth Application erfolgreich registriert (Client ID: {client_id})!")

    # 4. In Code schreiben
    print(f"\n[4/5] Hinterlege Voreinstellungen in PWA Quellcode...")
    update_notifications_js(project_id=str(project_id), client_id=client_id, host=host)

    # 5. Git Remote & Push
    print(f"\n[5/5] Git Remote Konfiguration...")
    remote_url = f"https://oauth2:{token}@{host.replace('https://', '')}/{project_path}.git"
    
    subprocess.run(["git", "remote", "remove", "gitlab"], cwd=REPO_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["git", "remote", "add", "gitlab", remote_url], cwd=REPO_DIR, check=True)
    print(f"✓ Git Remote 'gitlab' gesetzt auf: {host}/{project_path}.git")

    if args.push:
        print("\n🚀 Führe Git Push nach GitLab aus...")
        subprocess.run(["git", "add", "features/notifications.js"], cwd=REPO_DIR, check=True)
        subprocess.run(["git", "commit", "-m", "chore: auto-configure GitLab OAuth and Project defaults"], cwd=REPO_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["git", "push", "-u", "gitlab", "main"], cwd=REPO_DIR, check=True)
        print("✓ Erfolgreich zu GitLab gepusht!")
    else:
        print("\n💡 Tipp: Führe 'git push gitlab main' aus (oder starte mit --push), um die Konfiguration live zu schalten.")

    print("\n=============================================================================")
    print("🎉 FERTIG! 100% AUTOMATISIERUNG ABGESCHLOSSEN!")
    print("=============================================================================")
    print(f"GitLab Pages URL: {pages_url}")
    print(f"Auf deinem iPhone / iPad / Mac:")
    print(f"1. Öffne im Safari: {pages_url}")
    print(f"2. Tippe auf '🦊 Mit GitLab verbinden' (Face ID Anmeldung)")
    print(f"3. Tippe auf '✓ Einstellungen sichern' -> '🧪 Test-Push senden'")
    print("-> 0 Zeichen eingeben, keine GitLab-Menüs bedienen. Fertig!")
    print("=============================================================================\n")


if __name__ == "__main__":
    main()
