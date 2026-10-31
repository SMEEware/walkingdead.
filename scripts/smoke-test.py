#!/usr/bin/env python3
"""Exercise built binaries using an isolated, disposable instance."""

import argparse
import http.client
import http.cookiejar
import json
import os
from pathlib import Path
import platform
import select
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ui", action="store_true", help="Wait for UI verification before cleanup")
    options = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    system = {"Darwin": "darwin", "Linux": "linux"}[platform.system()]
    arch = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "amd64"}[platform.machine()]
    daemon = root / ".cache/test-bin/wdd"
    cli = root / f"dist/{system}_{arch}/wd"
    release = root / f"dist/{system}_{arch}/wdd"
    process = None

    with tempfile.TemporaryDirectory(prefix="smoke-", dir=root / ".cache") as temporary:
        fixture = Path(temporary)
        os.chmod(fixture, 0o700)
        data = fixture / "data"
        password = fixture / "password"
        password.write_text("password123")
        password.chmod(0o600)

        def command(binary, *arguments):
            result = subprocess.run([str(binary), *map(str, arguments)], capture_output=True, text=True, timeout=30)
            if result.returncode:
                raise RuntimeError(f"{binary.name} operation failed: {result.stderr[:500]}")
            return json.loads(result.stdout)

        def stop():
            nonlocal process
            if process is not None:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                process.stdout.close()
                process.stderr.close()
                process = None

        def start(directory):
            nonlocal process
            process = subprocess.Popen([str(daemon), "serve", "--data-dir", str(directory), "--password-file", str(password), "--listen", "127.0.0.1:0"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if not select.select([process.stdout], [], [], 15)[0]:
                raise RuntimeError("Daemon startup timed out")
            line = process.stdout.readline()
            if not line:
                raise RuntimeError("Daemon exited before startup")
            return json.loads(line)["listen"]

        try:
            command(daemon, "init", "--data-dir", data, "--username", "smee", "--password-file", password)
            base = start(data)
            jar = http.cookiejar.CookieJar()
            owner = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

            def request(path, method="GET", body=None, token=None):
                headers = {"Content-Type": "application/json", "Origin": base}
                if token:
                    headers["Authorization"] = "Bearer " + token
                req = urllib.request.Request(base + "/api/v1" + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
                try:
                    with owner.open(req, timeout=15) as response:
                        raw = response.read()
                        return response.status, json.loads(raw) if raw else None
                except urllib.error.HTTPError as error:
                    return error.code, json.loads(error.read())

            assert request("/sessions")[0] == 401
            assert request("/metrics")[0] == 401
            assert request("/openapi")[0] == 401
            assert request("/auth/login", "POST", {"username": "smee", "password": "password123"})[0] == 200
            assert request("/ai/settings", "PUT", {"providerKey": "synthetic-smoke-provider-key", "enabled": False})[0] == 200
            code, config = request("/system", "PUT", {"httpAddress": "127.0.0.1:0", "running": True, "mode": "interactive"})
            assert code == 200 and config["running"]
            host, port = config["httpAddress"].rsplit(":", 1)
            connection = http.client.HTTPConnection(host, int(port), timeout=10)
            try:
                for method, path, body in [("GET", "/.env", None), ("POST", "/login", "username=synthetic&password=synthetic"), ("GET", "/admin", None)]:
                    connection.request(method, path, body=body)
                    response = connection.getresponse()
                    assert response.status == (401 if method == "POST" else 200)
                    response.read()
            finally:
                connection.close()
            code, sessions = request("/sessions?q=admin&limit=1")
            assert code == 200 and len(sessions) == 1 and sessions[0]["eventCount"] == 3
            session_id = sessions[0]["id"]
            code, detail = request("/sessions/" + session_id)
            assert code == 200 and detail["retainedOnly"] and len(detail["events"]) == 3
            assert [event["ts"] for event in detail["events"]] == sorted(event["ts"] for event in detail["events"])
            assert request("/health")[1]["status"] == "ready"
            assert request("/openapi")[1] == json.loads((release.parent / "openapi.json").read_text())
            with owner.open(base + "/api/v1/metrics", timeout=15) as response:
                metrics = response.read().decode()
                assert response.headers["Cache-Control"] == "no-store"
                assert response.headers["X-Request-ID"]
                assert "walkingdead_events_persisted_total" in metrics
                assert "walkingdead_retained_events 3" in metrics
                assert "synthetic-smoke-provider-key" not in metrics and session_id not in metrics
            with owner.open(base + "/api/v1/stream", timeout=5) as response:
                assert response.headers["Content-Type"] == "text/event-stream"
                assert response.readline() == b"event: event:update\n"
            with urllib.request.urlopen(base + "/logs", timeout=5) as response:
                assert response.status == 200 and b"/_next/" in response.read()
            code, created = request("/keys", "POST", {"name": "smoke-reader", "scopes": ["events:read", "system:read"], "expiresInDays": 1})
            assert code == 201
            key_file = fixture / "api-key"
            key_file.write_text(created["key"])
            key_file.chmod(0o600)
            assert request("/system", "PUT", {"running": False}, created["key"])[0] == 403
            assert command(cli, "--url", base, "--key-file", key_file, "health")["retainedEvents"] == 3
            assert command(cli, "--url", base, "--key-file", key_file, "api-schema")["openapi"] == "3.0.3"
            assert command(cli, "--url", base, "--key-file", key_file, "sessions", session_id)["session"]["eventCount"] == 3
            assert b"synthetic-smoke-provider-key" not in (data / "vault.json").read_bytes()
            stop()
            backups = fixture / "backups"
            backups.mkdir(mode=0o700)
            backup = backups / "instance.wdbackup"
            assert command(daemon, "backup", "--data-dir", data, "--password-file", password, "--output", backup)["verified"]
            restored = fixture / "restored"
            assert command(daemon, "restore", "--data-dir", restored, "--password-file", password, "--backup-file", backup)["collectionStopped"]
            assert command(daemon, "verify", "--data-dir", restored, "--password-file", password)["verified"]
            denied = subprocess.run([str(release), "verify", "--data-dir", str(restored), "--password-file", str(password)], capture_output=True, text=True, timeout=15)
            assert denied.returncode != 0 and "development test vault" in denied.stderr
            base = start(restored)
            jar.clear()
            assert request("/auth/login", "POST", {"username": "smee", "password": "password123"})[0] == 200
            assert not request("/system")[1]["running"]
            assert request("/sessions/" + session_id)[1]["session"]["eventCount"] == 3
            assert request("/ai/settings")[1]["configured"]
            assert "synthetic-smoke-provider-key" not in json.dumps(request("/export")[1])
            print("PASS: embedded UI, authentication, scoped CLI, real connection timeline, OpenAPI, private metrics, SSE, encrypted backup/restore, restart and release-policy isolation.", flush=True)
            if options.ui:
                print(f"Disposable UI fixture: {base}/logs", flush=True)
                input("Press Enter after browser verification to stop and remove this fixture: ")
        finally:
            stop()
    print("Owned test daemon stopped; disposable fixture removed. Development vault untouched.", flush=True)


if __name__ == "__main__":
    main()
