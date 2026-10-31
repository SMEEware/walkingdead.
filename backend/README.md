# Walking Dead Backend

Go module behind the honeypot. One daemon (`wdd`) runs the decoys, classifies
every observation, stores it in an encrypted vault and serves the management API
together with the embedded console. A separate CLI (`wd`) talks to that API.

## Run

From the repository root, `./dev.sh` builds everything and starts a development
instance on `http://127.0.0.1:3000`. By hand:

```sh
./scripts/test-build.sh                                    # .cache/test-bin/wdd (development)
printf %s password123 | .cache/test-bin/wdd init  --data-dir data/development --username smee --password-file -
printf %s password123 | .cache/test-bin/wdd serve --data-dir data/development --password-file - --listen 127.0.0.1:3000
```

Release binaries come from `./build.sh` and refuse development vaults and
passwords shorter than 12 bytes.

## Commands

| Command | Purpose |
| --- | --- |
| `wdd init` | Create the owner account and an encrypted vault; prints a recovery code |
| `wdd serve` | Unlock the vault and serve API, console and decoys (`--listen`, `--tls-cert`, `--tls-key`, `--http-address`, `--allowed-origin`) |
| `wdd backup` / `restore` / `verify` | Encrypted backups; restores never overwrite existing data |
| `wdd recover` | Set a new password with the recovery code |
| `wd …` | CLI for every API feature; see the root README |

## Architecture

```
            ┌──────────────── wdd ────────────────────────────────────────┐
attacker ──▶│ collector  HTTP · SSH · Telnet · FTP · Redis · MySQL         │
            │     │ raw observation (model.Event)                          │
            │     ▼                                                        │
            │ detect     tags · MITRE ATT&CK · IOCs · severity             │
            │     ▼                                                        │
            │ server     record ─▶ vault (AES, Argon2id key)               │
            │            ├─▶ auto-block ─▶ blocklist                       │
            │            ├─▶ webhook queue (Slack, Discord, JSON)          │
            │            ├─▶ live SSE streams (/stream, /events/stream)    │
            │            └─▶ REST API + embedded console (webui)           │
            └──────────────────────────────────────────────────────────────┘
```

| Package | Responsibility |
| --- | --- |
| `cmd/wdd` | Daemon entry point, setup, unlock, backup and recovery |
| `cmd/wd` | CLI client |
| `internal/collector` | Decoy listeners and the emulated shell. Each connection gets a session ID, per-connection event caps, idle and session timeouts and a global connection limit |
| `internal/detect` | Rule-based classification, MITRE ATT&CK mapping, IOC extraction, default-credential detection and the attacker threat score |
| `internal/server` | Management API, authentication, sessions, API keys, intelligence aggregates, blocklist, webhooks, metrics and SSE |
| `internal/vault` | Encrypted single-file state with atomic writes, backups and restore |
| `internal/winacl` | Windows equivalent of `chmod 700/600`: protected DACLs for the vault and credential files |
| `internal/intelligence` | DeepSeek client with privacy filtering and strict, evidence-grounded response validation |
| `internal/webui` | Embeds the exported console (`webui` build tag) |
| `api/openapi.json` | API contract, embedded into `wdd`, served at `/api/v1/openapi` and rendered at `/docs` |

## Decoys

All decoys share the interaction profile:

- **passive** records connections, credentials and pre-auth commands and never grants access;
- **interactive** grants SSH and Telnet sessions for weak passwords or on the third
  attempt and runs the emulated shell; Redis accepts write commands; HTTP serves a
  fake admin login;
- **tarpit** answers byte by byte and delays authentication.

The emulated shell answers common reconnaissance (`uname`, `id`, `ps`, `free`,
`cat /etc/passwd`, `/proc/cpuinfo`), pretends downloads succeed and serves a bait
`.env` with honeytoken credentials. Nothing an attacker types is ever executed.
SSH port-forwarding requests are recorded as proxy abuse and rejected.

## Detection

`detect.Analyze` runs on every event before it is stored. It never lowers a
severity and promotes the event type (`scan`, `auth_fail`, `exploit`) when rules
match. Rule sets cover HTTP paths, bodies and user agents (SQL injection, command
injection, Log4Shell, Shellshock, traversal, exploit probes, secret harvesting,
CMS and admin scans, scanners and tool clients), shell commands (downloads,
miners, persistence, evasion, execution, botnet loaders, discovery with word
boundaries), Redis commands and well-known default credentials. URLs and hosts
in payloads and commands become IOCs.

`detect.Score` ranks attackers from their worst severity, event volume, the
number of services touched and technique variety, capped at 100.

## API

The full reference is served by every instance at `/docs` and lives in
`api/openapi.json`. `TestOpenAPIListsEveryManagementOperation` fails when a route
is missing from the contract, and `TestActualResponsesMatchOpenAPI` validates real
responses against it. Highlights for monitors:

- `GET /api/v1/overview` — one-call snapshot with a recency-weighted threat level;
- `GET /api/v1/events/stream` — live SSE stream of full events with server-side filters;
- `GET /api/v1/logs/recent?service=&type=&ip=&tag=&minSeverity=&since=` — filtered history;
- `GET /api/v1/attackers`, `/intel`, `/blocklist/export?format=`.

Owner sessions use an HttpOnly cookie; automation uses `Authorization: Bearer wdk_…`
keys with explicit scopes and expiry. Browser mutations are origin-checked and
management outside loopback requires TLS.

## Storage and limits

The vault keeps configuration, events, briefings, notifications, the blocklist,
API key hashes and the audit trail in one encrypted document that is rewritten
atomically on every change. Retention keeps the newest 10,000 events or 16 MiB of
encoded events. Each decoy accepts at most 64 concurrent TCP connections (HTTP:
128 connections, 32 concurrent requests); a connection records at most 200 events.
Webhooks are limited to 20 deliveries per minute, live event streams to 32.

On Linux and macOS the vault directory and credential files must be owned by the
current user with no group or other permissions. On Windows the vault directory
receives a protected ACL that only grants the current user, SYSTEM and
Administrators, and files that grant access to Everyone or Users are refused.

## Tests

```sh
cd backend
go test ./...                                   # includes real decoy round trips
go test -race ./...
go test -tags testcredentials ./internal/vault
```

`./scripts/check.sh` runs all of the above plus the frontend checks.
