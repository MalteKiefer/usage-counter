import { localWallMs, wallMs } from '../src/lib/derive.js';
import { isNumber, isOptionalNumber, isRealDateTime, DATE_TIME } from './validation.js';

export const MAX_VALUE = 100_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

// Shared by the API and the restore, so both accept exactly the same data.

export function dateTimeError(value) {
  if (typeof value !== 'string' || !DATE_TIME.test(value) || !isRealDateTime(value)) {
    return 'Datum und Uhrzeit ungültig';
  }
  if (wallMs(value) > localWallMs() + FUTURE_TOLERANCE_MS) {
    return 'Zeitpunkt liegt in der Zukunft';
  }
  return null;
}

export function noteError(note) {
  if (note !== undefined && (typeof note !== 'string' || note.length > 200)) {
    return 'Notiz max. 200 Zeichen';
  }
  return null;
}

export function nameError(name) {
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 100) {
    return 'Name zwischen 1 und 100 Zeichen';
  }
  return null;
}

export function tankSizeError(size) {
  if (size != null && (!isNumber(size) || size <= 0 || size > MAX_VALUE)) {
    return 'Tankgröße muss zwischen 0 und 100.000 Litern liegen';
  }
  return null;
}

export function validateReading({ read_at, meter, tank_level, note }, meterRow, tankSize) {
  const dateError = dateTimeError(read_at);
  if (dateError) return dateError;
  if (!isNumber(meter) || meter < 0) return 'Zählerstand muss eine positive Zahl sein';
  if (tank_level != null) {
    if (meterRow.kind !== 'oil') return 'Anzeiger gibt es nur beim Heizöl';
    if (!isNumber(tank_level) || tank_level < 0 || (tankSize != null && tank_level > tankSize)) {
      return 'Füllstand am Anzeiger ungültig';
    }
  }
  return noteError(note);
}

export function validateTankLevel({ read_at, level, note }, tankSize) {
  const dateError = dateTimeError(read_at);
  if (dateError) return dateError;
  if (!isNumber(level) || level < 0 || (tankSize != null && level > tankSize)) {
    return 'Füllstand ungültig oder größer als Tankgröße';
  }
  return noteError(note);
}

export function validateRefill({ filled_at, meter, liters, total_eur, level_after, note }, tankSize) {
  const dateError = dateTimeError(filled_at);
  if (dateError) return dateError;
  if (!isOptionalNumber(meter) || (meter ?? 0) < 0) return 'Zählerstand bei Tankung ungültig';
  if (!isNumber(liters) || liters <= 0 || liters > MAX_VALUE) {
    return 'Menge muss zwischen 0 und 100.000 Litern liegen';
  }
  if (!isOptionalNumber(total_eur) || (total_eur ?? 0) < 0) return 'Preis ungültig';
  if (!isOptionalNumber(level_after) || (level_after ?? 0) < 0) return 'Füllstand ungültig';
  if (level_after != null && tankSize != null && level_after > tankSize) {
    return 'Füllstand größer als Tankgröße';
  }
  return noteError(note);
}

// Counter only goes up: a value must fit between the readings before and after it.
export function neighbourError(prev, next, meter) {
  if (prev && meter < prev.meter) {
    return `Zählerstand liegt unter der vorherigen Ablesung (${prev.meter})`;
  }
  if (next && meter > next.meter) {
    return `Zählerstand liegt über der nächsten Ablesung (${next.meter})`;
  }
  return null;
}
