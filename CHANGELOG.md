# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Restore applies the same checks as the API: limits, tank size and meter order.
- Restore answers malformed entries with a client error instead of a server error.
- Restore body limit lowered to 10 MB.
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
