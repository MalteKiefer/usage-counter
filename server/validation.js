export const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
export const isOptionalNumber = (value) => value == null || isNumber(value);
export const isId = (value) => Number.isInteger(value) && value > 0;

// Date rolls 2026-02-30 over to March, so compare the formatted result with the input.
export function isRealDateTime(value) {
  const ms = Date.parse(`${value}:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 16) === value;
}
