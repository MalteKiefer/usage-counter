# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [3.0.1] 2026-11-08

### Fixed

- Deletes and backup restore use the app's own confirmation dialog instead of the browser's native one.

## [3.0.0] 2026-11-08

### Breaking

- API: tank size is set with `PUT /api/meters/:id`. Refills and gauge values use `/api/meters/:id/refills` and `/api/meters/:id/tank-levels`.
- API errors are `{ error: <code>, params }` instead of German text. Clients must translate the codes.
- Backup format is version 2. Version 1 backups are still restored.
- Preferences: `numbers` is replaced by `locale`. Stored preferences are converted on read.


### Changed

- Languages, number formats, currencies and units are defined in one place (`src/lib/locale.js`, `src/lib/units.js`). Adding a language means one file in `src/i18n/` and an entry in `LANGUAGES`.
- Preferences: `numbers` is replaced by `locale` (a locale tag such as `de-DE`), and `currency` is new. Stored preferences are converted on read.
- Money, dates, numbers and unit names follow the chosen locale and currency. Weekday names come from the locale.
- The API answers errors with a code and parameters (`error`, `params`) instead of German text. The client translates them, so an API client has to do the same.
- Server log and startup messages are in English.

### Added

- Serial number (Zählernummer) for water, power and gas meters, editable per meter.
- Gas meter kind. Gas can be supplied directly (readings, like water) or from a LPG tank.
- Meters can be edited (name, serial number, tank size).
- Gas tanks have a density (kg per litre, default 0.54). The tank card shows the size in the other unit as well.
- Gas tanks take their size, refills and gauge values in litres or kilograms (`tank_unit`). Oil tanks stay in litres.

### Changed

- Tanks belong to meters, not objects. Oil and gas meters hold the tank size, refills and gauge values.
  Existing databases are converted on start: an object's tank moves to its oil meter, and an oil meter is created when an object has tank data but none.
- API: tank size is set with `PUT /api/meters/:id`, refills and gauge values use `/api/meters/:id/refills` and `/api/meters/:id/tank-levels`.
- The refill field `liters` holds the amount in the tank's unit (litres or kilograms).
- Backup format is version 2. Version 1 backups are still restored and converted.

## [2.1.1] 2026-11-08

### Fixed

- Sign-in: callback is bound to the browser that started it (login CSRF).
- Sign-in: sign-in routes are rate limited (CodeQL).
- Sign-in: signing in again ends the earlier session of the same browser.
- Session response is `no-store`. Session lookup runs only for API and auth paths.
- Preference changes are saved in order.
- Failed profile picture fetch keeps the earlier picture.

## [2.1.0] 2026-11-08

### Added

- Sign-in with Pocket-ID (OpenID Connect, PKCE). Enabled with `OIDC_ENABLED=true`.
- Only the mail addresses in `OIDC_ALLOWED_EMAILS` can sign in. The list is required when sign-in is enabled.
- Language and number and date formats are stored per account when signed in.
- `SESSION_DAYS` sets how long a sign-in lasts (default 7).

### Security

- With sign-in enabled, every API call needs a session. Writes from other origins are refused.
- Session tokens are stored only as hashes. Profile pictures are fetched from the issuer only, with a size limit.

## [2.0.0] 2026-11-08

### Changed (breaking)

- The database file is `usage.db` and the variable is `DB_PATH` (was `oil.db` and `OIL_DB`).
- The Compose data volume is `data` (was `oil-data`). Copy existing data once, see README.

### Added

- Settings are read in one place and validated at start-up. New variables: `BACKUP_LIMIT_MB`, `OIDC_*`.
- Secrets can be read from files via `NAME_FILE`.
- Prepared single sign-on settings for Pocket-ID. Login is not active yet.
- `.env.example` documents all settings.

## [1.2.0] 2026-11-08

### Added

- Redesigned README with badges, feature overview, quick start and security notes.
- Backup export and restore share a 25 MB limit, so every exported backup can be restored.

### Fixed

- Restore applies the same checks as the API: limits, tank size and meter order.
- Restore checks refill meter values against readings in time order, not in the order rows are listed.
- Restore answers malformed entries with a client error instead of a server error.
- Restore body limit is 25 MB and export is capped at the same size.
- Backup download no longer revokes its object URL before the browser starts the download.
- The app title is a top-level heading again.
- Dialogs move focus into themselves and return it on close. Escape closes the menu.

## [1.1.0] 2026-11-08

### Added

- Backup of the whole database as a JSON file, and restore from such a file. Restore replaces all
  data in one transaction and checks every row and reference first.

### Changed

- Object and meter management, backup and settings sit in one menu in a sticky app bar.
- Management panels open as dialogs that close with Escape or a click outside.
- Layout works on phones and tablets without horizontal scrolling.

### Fixed

- Numbers typed with a dot in German browsers were read as thousands, for example 816.613 became 816613.
- Dependency alert for minimatch (development dependency, GHSA-g3hv-75wg-m249) resolved by override.

## [1.0.1] 2026-11-08

### Changed

- The runtime image no longer ships npm and corepack.
- The base image is pinned by digest.

## [1.0.0] 2026-11-08

### Added

- Objects (for example houses) with any number of meters: heating oil, water, power.
- Garden meter as a sub-meter behind a water meter, with house and garden shares.
- Readings with consumption per interval, per day, cumulative, per month and per weekday.
- Tank level estimate from refills, meter readings and gauge values, with a range forecast.
- Refills with amount, price and tank level after delivery.
- Atomic saves for several meters read at the same moment.
- German and English interface, number and date formats chosen per browser.
- Docker image, Docker Compose file and CI with lint, tests, image scan and workflow lint.
