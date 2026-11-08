<div align="center">

# 🔥 Usage Counter

**Self-hosted tracker for heating oil, water and power meters.**
Record readings, see consumption per interval, day and month, and find out how long the oil in the tank will last.

[![CI](https://github.com/MalteKiefer/usage-counter/actions/workflows/ci.yml/badge.svg)](https://github.com/MalteKiefer/usage-counter/actions/workflows/ci.yml)
[![CodeQL](https://github.com/MalteKiefer/usage-counter/actions/workflows/codeql.yml/badge.svg)](https://github.com/MalteKiefer/usage-counter/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/MalteKiefer/usage-counter?sort=semver&color=ff8a3d)](https://github.com/MalteKiefer/usage-counter/releases)
[![License: MIT](https://img.shields.io/github/license/MalteKiefer/usage-counter?color=4fd1c5)](LICENSE)
[![Container](https://img.shields.io/badge/ghcr.io-usage--counter-2496ED?logo=docker&logoColor=white)](https://github.com/MalteKiefer/usage-counter/pkgs/container/usage-counter)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)

[**Quick start**](#-quick-start) · [**Features**](#-features) · [**Configuration**](#%EF%B8%8F-configuration) · [**Security**](#-security) · [**Changelog**](CHANGELOG.md) · [**Contributing**](CONTRIBUTING.md)

</div>

---

## ✨ Features

| | Feature | What you get |
|:-:|---|---|
| 🏠 | **Objects** | Houses or flats, each with any number of meters |
| 🛢️ | **Heating oil** | Readings, refills with price per litre, gauge values |
| 💧 | **Water** | Main meter plus garden meter as sub-meter, with house and garden shares |
| ⚡ | **Power** | Any number of power meters with the same analysis |
| 📈 | **Charts** | Per reading, per day, cumulative, per month, per weekday |
| 🎯 | **Tank forecast** | Estimated tank level and the date the oil runs out |
| 🗓️ | **Periods** | 30, 90, 120 days, one year or all data |
| 💾 | **Backup** | Whole database as JSON, restored with full validation |
| 🌍 | **Languages** | German and English, number and date formats per browser |
| 🐳 | **Docker** | Published image on GitHub Container Registry for every release |

## 🚀 Quick start

### Docker Compose (recommended)

```bash
USAGE_COUNTER_VERSION=3.0.1 docker compose up -d
```

Open **http://127.0.0.1:8080**. Data lives in the Docker volume `data`.

> [!NOTE]
> [!IMPORTANT]
> Version 2 renamed the volume to `data`, the database file to `usage.db` and the variable to `DB_PATH`.
> To keep existing data, copy the old file into the new volume once:
>
> ```bash
> docker run --rm -v usage-counter_oil-data:/from -v usage-counter_data:/to alpine \
>   sh -c 'cp /from/oil.db /to/usage.db'
> ```

To build from source instead: `docker compose up -d --build`.

### Docker run

```bash
docker run -d --name usage-counter -p 127.0.0.1:8080:3001 \
  -v usage-counter:/data --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges:true \
  ghcr.io/maltekiefer/usage-counter:3.0.1
```

### From source

Requirements: **Node.js 24** or newer.

```bash
npm ci
npm run dev          # API on :3001, web app on :5173
```

Production build:

```bash
npm run build
NODE_ENV=production npm start
```

## ⚙️ Configuration

All settings are read from environment variables. Copy [`.env.example`](.env.example) to `.env` to set them for Docker Compose.
Invalid values stop the server at start-up with a message that names the variable.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3001` | Port of the API server |
| `HOST` | `127.0.0.1` | Interface to bind. The container sets `0.0.0.0` |
| `DB_PATH` | `./usage.db` | Path of the SQLite database file |
| `ALLOWED_HOSTS` | *(empty)* | Extra host names accepted in the Host header, comma separated |
| `BACKUP_LIMIT_MB` | `25` | Largest backup that can be exported or restored, 1 to 100 |
| `NODE_ENV` | *(unset)* | `production` serves the built web app from `dist/` |
| `OIDC_ENABLED` | `false` | `true` turns on sign-in with Pocket-ID, see below |
| `SESSION_DAYS` | `7` | How long a sign-in stays valid, 1 to 30 days |
| `USAGE_COUNTER_VERSION` | `3.0.1` | Image tag used by Docker Compose |

### Secrets from files

Any secret can be read from a file instead of the variable itself: set `NAME_FILE` to the path.
This works with Docker secrets, which mount files under `/run/secrets/`.

### Sign-in with Pocket-ID

With `OIDC_ENABLED=true` the app shows a login screen and every API call needs a session. Login uses OpenID Connect with PKCE. Data is shared by all signed-in users, while language and number and date formats are stored per account.

| Variable | Meaning |
|---|---|
| `OIDC_ENABLED` | `true` turns on sign-in. The server stops at start-up if a required value is missing |
| `OIDC_ISSUER_URL` | Pocket-ID issuer, must be `https` (or `http` on localhost) |
| `OIDC_CLIENT_ID` | Client ID of the app in Pocket-ID |
| `OIDC_CLIENT_SECRET` or `OIDC_CLIENT_SECRET_FILE` | Client secret, preferably as a file |
| `OIDC_REDIRECT_URL` | Callback URL `https://<your-host>/auth/callback`, must be `https` (or `http` on localhost) |
| `OIDC_ALLOWED_EMAILS` | Comma separated list of the only mail addresses that may sign in. Required |
| `OIDC_SCOPES` | Default `openid profile email` |

Setup in Pocket-ID:

1. Create an OIDC client with the callback URL `OIDC_REDIRECT_URL`.
2. Copy the client ID and secret. Store the secret in `secrets/oidc_client_secret` (ignored by git).
3. In `docker-compose.yml`, uncomment `OIDC_CLIENT_SECRET_FILE`, the service `secrets` block and the top level `secrets` block.
4. Set `OIDC_ENABLED=true`, the issuer, client ID, redirect URL and allowed mail addresses in `.env`, then run `docker compose up -d`.

The session cookie is `HttpOnly` and `SameSite=Lax`, and it is `Secure` when the redirect URL uses `https`. Only a hash of the session token is stored. Writes from other origins are refused. Behind a reverse proxy, add the public host name to `ALLOWED_HOSTS`.

## 🔒 Security

> [!WARNING]
> Without `OIDC_ENABLED=true` the API has **no authentication**. Run it on a trusted host only, keep the loopback binding,
> or enable sign-in with Pocket-ID.

- Requests are rejected unless the Host header matches `localhost`, `127.0.0.1`, `::1` or `ALLOWED_HOSTS`. This blocks DNS rebinding.
- Security headers: Content-Security-Policy, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- The container runs as user `1000` with a read-only root filesystem, all capabilities dropped and `no-new-privileges`.
- Release images carry build provenance and an SBOM.
- Dependencies are watched by Dependabot with a 7-day cooldown, CodeQL and dependency review run on every pull request.
- Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## 🧪 Development

| Command | What it does |
|---|---|
| `npm run dev` | API and web app with hot reload |
| `npm run lint` | ESLint over server and client |
| `npm test` | Unit and API tests |
| `npm run build` | Production build of the web app |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the pull request workflow.

## 🧱 Tech stack

React 19 · Vite · Recharts · Express 5 · SQLite (`node:sqlite`) · Docker · GitHub Actions

## 📜 License

[MIT](LICENSE) © Malte Kiefer
