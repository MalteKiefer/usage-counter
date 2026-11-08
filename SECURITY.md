# Security policy

## Supported versions

Only the latest release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 1.x     | yes       |

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/MalteKiefer/usage-counter/security/advisories/new).
Do not open a public issue for security problems.

Include the affected version or commit, the steps to reproduce, and the impact as you see it.
Reports are reviewed on a best-effort basis. You will receive an answer on the advisory.

## Known limitations

- The HTTP API has **no authentication yet**. Anyone who can reach it can read and change the data.
  Run it only on a trusted host, keep the default loopback binding, or put it behind an
  authenticating reverse proxy.
- The Host header is checked against `localhost`, `127.0.0.1`, `::1` and the names listed in
  `ALLOWED_HOSTS`. This protects against DNS rebinding, not against users who can reach the port directly.
- Data is stored unencrypted in a SQLite file. Protect the file and its volume accordingly.
