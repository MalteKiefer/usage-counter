// A meter has a tank when it is oil, or gas supplied from a tank (LPG). Tanks take refills and gauge values.
export function isTankMeter(meter) {
  return meter.kind === 'oil' || (meter.kind === 'gas' && meter.tank_size != null);
}

// Meter kinds that carry a serial number and kinds that can have a tank.
export const SERIAL_KINDS = ['water', 'power', 'gas'];
export const TANK_KINDS = ['oil', 'gas'];
// Tank units as stored: 'l' for litres, 'kg' for kilograms.
export const TANK_UNITS = ['l', 'kg'];

// Density of LPG in kilograms per litre, used when a gas tank has none of its own. Propane and butane mixes are about 0.5 to 0.55.
export const DEFAULT_LPG_DENSITY = 0.54;
export const DENSITY_RANGE = { min: 0.3, max: 1 };

// Converts a tank size between litres and kilograms with a density in kg per litre.
export function convertTank(size, fromUnit, density) {
  return fromUnit === 'kg' ? size / density : size * density;
}
