import { localWallMs, wallMs } from '../src/lib/derive.js';
import { DENSITY_RANGE, isTankMeter, SERIAL_KINDS, TANK_UNITS } from '../src/lib/meters.js';
import { isNumber, isOptionalNumber, isRealDateTime, DATE_TIME } from './validation.js';

export const MAX_VALUE = 100_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const SERIAL_PATTERN = /^[A-Za-z0-9 ./-]+$/;

// A validation problem: a stable code the client translates, plus the values its message needs.
export const problem = (code, params) => ({ code, params });

// Shared by the API and the restore, so both accept exactly the same data. Each check returns a problem or null.

export function dateTimeError(value) {
  if (typeof value !== 'string' || !DATE_TIME.test(value) || !isRealDateTime(value)) {
    return problem('date.invalid');
  }
  if (wallMs(value) > localWallMs() + FUTURE_TOLERANCE_MS) {
    return problem('date.future');
  }
  return null;
}

export function noteError(note) {
  if (note !== undefined && (typeof note !== 'string' || note.length > 200)) {
    return problem('note.tooLong', { max: 200 });
  }
  return null;
}

export function nameError(name) {
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 100) {
    return problem('name.invalid', { min: 1, max: 100 });
  }
  return null;
}

export function tankSizeError(size) {
  if (size != null && (!isNumber(size) || size <= 0 || size > MAX_VALUE)) {
    return problem('tankSize.range', { max: MAX_VALUE });
  }
  return null;
}

// Meter numbers are shown and printed, so only plain characters are accepted.
export function serialError(serial, kind) {
  if (serial == null) return null;
  if (typeof serial !== 'string' || serial.trim().length > 50) return problem('serial.tooLong', { max: 50 });
  const value = serial.trim();
  if (value === '') return null;
  if (!SERIAL_PATTERN.test(value)) return problem('serial.chars');
  if (!SERIAL_KINDS.includes(kind)) return problem('serial.kind');
  return null;
}

export function tankError(size, kind) {
  if (size == null) return null;
  if (kind !== 'oil' && kind !== 'gas') return problem('tank.kind');
  return tankSizeError(size);
}

// Oil tanks are always litres. Gas tanks can be litres or kilograms.
export function tankUnitError(unit, kind) {
  if (unit === undefined || unit === null) return null;
  if (!TANK_UNITS.includes(unit)) return problem('tankUnit.invalid');
  if (unit !== 'l' && kind !== 'gas') return problem('tankUnit.gasOnly');
  return null;
}

// Kilograms per litre of LPG. Only gas tanks have one; it converts between litres and kilograms.
export function densityError(density, kind) {
  if (density === undefined || density === null) return null;
  if (kind !== 'gas') return problem('density.gasOnly');
  if (!isNumber(density) || density < DENSITY_RANGE.min || density > DENSITY_RANGE.max) {
    return problem('density.range', DENSITY_RANGE);
  }
  return null;
}

export function validateReading({ read_at, meter, tank_level, note }, meterRow) {
  const dateError = dateTimeError(read_at);
  if (dateError) return dateError;
  if (!isNumber(meter) || meter < 0) return problem('reading.meterInvalid');
  if (tank_level != null) {
    if (!isTankMeter(meterRow)) return problem('reading.gaugeNeedsTank');
    const tankSize = meterRow.tank_size;
    if (!isNumber(tank_level) || tank_level < 0 || (tankSize != null && tank_level > tankSize)) {
      return problem('reading.gaugeInvalid');
    }
  }
  return noteError(note);
}

export function validateTankLevel({ read_at, level, note }, tankSize) {
  const dateError = dateTimeError(read_at);
  if (dateError) return dateError;
  if (!isNumber(level) || level < 0 || (tankSize != null && level > tankSize)) {
    return problem('tankLevel.invalid');
  }
  return noteError(note);
}

export function validateRefill({ filled_at, meter, liters, total_eur, level_after, note }, tankSize) {
  const dateError = dateTimeError(filled_at);
  if (dateError) return dateError;
  if (!isOptionalNumber(meter) || (meter ?? 0) < 0) return problem('refill.meterInvalid');
  if (!isNumber(liters) || liters <= 0 || liters > MAX_VALUE) {
    return problem('refill.amount', { max: MAX_VALUE });
  }
  if (!isOptionalNumber(total_eur) || (total_eur ?? 0) < 0) return problem('refill.price');
  if (!isOptionalNumber(level_after) || (level_after ?? 0) < 0) return problem('refill.level');
  if (level_after != null && tankSize != null && level_after > tankSize) {
    return problem('refill.levelAboveTank');
  }
  return noteError(note);
}

// Counter only goes up: a value must fit between the readings before and after it.
export function neighbourError(prev, next, meter) {
  if (prev && meter < prev.meter) return problem('reading.belowPrevious', { previous: prev.meter });
  if (next && meter > next.meter) return problem('reading.aboveNext', { next: next.meter });
  return null;
}
