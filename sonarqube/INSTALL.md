# SonarQube Community — Local Install (Docker)

How the local SonarQube Community server for this project was installed. Runs
entirely in Docker; nothing installed on the host except Docker itself. Free
(Community Edition, LGPL v3).

The compose stack lives in this directory: [`docker-compose.yml`](./docker-compose.yml).

---

## 1. Prerequisites

- **Docker** + **Docker Compose v2**. Verified with:
  - `docker --version` → Docker 29.6.1
  - `docker compose version` → Compose v2.39.1
- **WSL2:** enable the distribution under Docker Desktop → Settings →
  Resources → WSL Integration if `docker` is unavailable inside WSL.
- **Kernel setting** `vm.max_map_count ≥ 524288` (Elasticsearch, which SonarQube
  embeds, refuses to start otherwise).

Check it:

```bash
sysctl vm.max_map_count
```

On this system it was already `1048576` (above the required minimum) — no change
needed. If yours is lower, raise it:

```bash
# temporary (until reboot)
sudo sysctl -w vm.max_map_count=524288
# persistent
echo 'vm.max_map_count=524288' | sudo tee /etc/sysctl.d/99-sonarqube.conf
```

---

## 2. The compose stack

`docker-compose.yml` defines two services:

- **sonarqube** (`sonarqube:community`) — the server, published on `localhost:9000`.
- **db** (`postgres:15`) — persistent backing store.

Named volumes persist SonarQube data, extensions, logs, and the Postgres database
across restarts. The default JDBC credentials (`sonar`/`sonar`) are only reachable
inside the compose network — fine for local use.

---

## 3. Start the stack

```bash
cd <project-root>/sonarqube
docker compose up -d
```

First boot is slow (~1–2 min) — the server has to initialize Elasticsearch and
the database schema. Poll until it reports `UP`:

```bash
for i in $(seq 1 40); do
  s=$(curl -s http://localhost:9000/api/system/status)
  echo "$s" | grep -q '"status":"UP"' && { echo "READY"; break; }
  echo "waiting... $s"; sleep 5
done
```

Expected final line: `{"id":"...","version":"26.x","status":"UP"}`.

---

## 4. First login + change the admin password

Open http://localhost:9000 and log in with the default credentials:

- **Username:** `admin`
- **Password:** `admin`

> ⚠️ **Change the password immediately.** The default `admin`/`admin` grants full
> control of the server. SonarQube 26.x forces a reset on first UI login. Do it
> before the server is reachable from anywhere but localhost.
> UI: top-right avatar → **My Account → Security**.

---

## 5. Generate a scanner token

The scanner authenticates with a token, not a password. Generate a global
analysis token via the API (works even before the first UI login, using the
default admin credentials):

```bash
curl -s -u admin:admin -X POST \
  "http://localhost:9000/api/user_tokens/generate" \
  -d "name=orchestration-scanner&type=GLOBAL_ANALYSIS_TOKEN"
```

Response contains the token (`"token":"sqa_..."`). Copy it. Tokens are shown
once — regenerate if lost. If you have already changed the admin password, swap
`admin:admin` for `admin:<new-password>`.

---

## 6. Store the token for the scan script

The `sonar` agent's scan helper reads `.claude/sonar.env` (gitignored — never
committed). Create it with your token:

```
# <project-root>/.claude/sonar.env
SONAR_HOST_URL=http://localhost:9000
SONAR_TOKEN=sqa_...your-token...
SONAR_DOCKER_NETWORK=sonarqube_default
SONAR_INTERNAL_URL=http://sonarqube:9000
```

- `SONAR_DOCKER_NETWORK` — the compose network the scanner container joins to
  reach the server (compose names it `<dir>_default`, i.e. `sonarqube_default`).
- `SONAR_INTERNAL_URL` — the in-network URL the scanner uses (compose service
  alias `sonarqube`), distinct from the host `SONAR_HOST_URL` used for polling.

---

## 7. Run a scan

Uses the dockerized `sonarsource/sonar-scanner-cli` (nothing installed on the
host); it joins the compose network, submits the analysis, waits, then prints the
quality gate + open issues.

```bash
cd <project-root>
bash .claude/scripts/sonar_scan.sh <project_dir> <project_key> [sources]

# example:
bash .claude/scripts/sonar_scan.sh "$(pwd)" orchestration .
```

View results in the UI: `http://localhost:9000/dashboard?id=<project_key>`.

---

## 8. Optional Python coverage

Generate an XML coverage report before scanning:

```bash
pytest --cov=<your-package> --cov-report=xml
```

Then create or update `sonar-project.properties` in the project root:

```properties
sonar.python.version=3.10
sonar.python.coverage.reportPaths=coverage.xml
```

The Dockerized scanner runs from the mounted project root and reads this file
automatically. Keep scanner tokens out of `sonar-project.properties`; the core
scanner reads the token from `.claude/sonar.env`.

---

## 9. Managing the stack

```bash
cd <project-root>/sonarqube
docker compose logs -f sonarqube   # tail server logs
docker compose stop                # stop (data kept)
docker compose up -d               # start again
docker compose down                # remove containers (named volumes kept)
docker compose down -v             # remove containers AND all data
```

---

## Notes / limitations

- **Community Edition = main branch only.** No per-branch or per-PR analysis
  (those are paid tiers). A scan reflects the whole project (or the server's
  configured "new code" definition), not an isolated diff.
- **Free**, but does not include branch/PR analysis, extra languages, or the
  security rule set that Developer/Enterprise editions add.
- **Token safety:** the scanner token lives only in gitignored `.claude/sonar.env`.
  Never commit it. Rotate via the API command in step 5 if exposed.
