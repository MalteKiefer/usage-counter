# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

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
