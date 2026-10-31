# Project conventions

- Write code comments, docstrings, documentation, and user-facing project text in English.
- Keep comments brief and only explain non-obvious intent, constraints, or invariants.
- Avoid comments that restate the code, tutorial commentary, and commented-out code.
- Keep detailed conceptual explanations in the conversation or documentation.
- After testing, stop the project's development servers, test environments, and their child processes. Verify that their listening ports are released so the user can start them manually. Leave an environment running only when the user explicitly requests it.
- Keep setup and startup non-invasive: use project-owned paths for installed runtimes, dependencies, build artifacts, and caches. Do not install global packages or modify system packages, shell profiles, firewall rules, or system services automatically.
- Separate development setup from release startup. Pin dependency downloads and verify their integrity. Detect unsupported platforms or missing native prerequisites and report them clearly instead of changing the system.
- Startup scripts must track and clean up only processes they own. Keep persistent data, configuration, and keys separate from disposable runtime files and caches.
- Keep the project layout coherent. Documentation lives in README.md, backend/README.md and frontend/README.md (README media in assets/readme/); environment settings are documented in frontend/.env.example.
- Before every commit, review the READMEs and frontend/.env.example. Update them in the same change to match actual behavior, structure, commands, configuration, and prerequisites. Clearly distinguish implemented features from planned work; do not commit contradictory documentation.
- Work locally on `main`. Push only after the user confirms the project is ready and explicitly requests publishing.
- Use `smee` / `password123` for development UI and integration test accounts. Build these instances with `testcredentials`; keep release password requirements unchanged.
- Preserve the encrypted development vault at `data/development/`, including its configured DeepSeek key, throughout development unless the user explicitly requests removal. Stop development processes after agent-run tests without deleting this configuration. Remove only separately created disposable integration fixtures.
