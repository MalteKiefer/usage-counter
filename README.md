# Usage Counter

Self-hosted tracker for heating oil, water and power meters. Record meter readings, see consumption
per interval, per day and per month, and estimate how long the heating oil in the tank will last.

## Features

- Objects (houses, flats) with any number of meters: heating oil, water, power.
- Garden meter as a sub-meter behind the water meter, with house and garden shares.
- Consumption charts and tables for 30, 90 and 120 days, one year or all data.
- Oil tank level estimate from refills, meter readings and gauge values, with a forecast of the reach.
- German and English interface. Number and date formats are chosen per browser.
- SQLite database, one file, no external services.
- Backup and restore as a JSON file from the app.

## Quick start with Docker Compose

```bash
docker compose up -d --build
```

The app is then available at http://127.0.0.1:8080. The data lives in the volume `oil-data`.

Read the [security notes](#security) before you expose it anywhere.

## Quick start from source

Requirements: Node.js 24 or newer.

```bash
npm ci
npm run dev        # API on port 3001, web app on port 5173
```

For a production build:

```bash
npm run build
NODE_ENV=production npm start
```

## Configuration

| Variable        | Default               | Meaning                                                           |
| --------------- | --------------------- | ----------------------------------------------------------------- |
| `PORT`          | `3001`                | Port of the API server.                                           |
| `HOST`          | `127.0.0.1`           | Interface the server binds to. The container sets `0.0.0.0`.      |
| `OIL_DB`        | `./oil.db`            | Path of the SQLite database file.                                 |
| `ALLOWED_HOSTS` | empty                 | Extra host names accepted in the Host header, comma separated.    |
| `NODE_ENV`      | unset                 | Set to `production` to serve the built web app from `dist/`.      |

## Security

- The API has **no authentication yet**. Run it on a trusted host only and keep the loopback binding,
  or place it behind an authenticating reverse proxy.
- Requests are rejected unless the Host header matches `localhost`, `127.0.0.1`, `::1` or `ALLOWED_HOSTS`.
- The container runs as an unprivileged user with a read-only root filesystem, no added capabilities,
  and no-new-privileges.
- Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## Development

```bash
npm run lint       # ESLint
npm test           # unit and API tests
npm run build      # production build of the web app
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

MIT, see [LICENSE](LICENSE).
