import { unitText } from './format.js';

// Unit of each meter kind and the digits shown for it. The day unit is built from the translated word for "day".
const METER_UNIT = {
  oil: { unit: 'liter', digits: 1 },
  water: { unit: 'cubic-meter', digits: 3 },
  power: { unit: 'kilowatt-hour', digits: 1 },
  gas: { unit: 'cubic-meter', digits: 3 },
};

// Stored tank units ('l', 'kg') as units for the formatter.
const TANK_UNIT = { l: 'liter', kg: 'kilogram' };

export function unitsFor(kind, t) {
  const { unit, digits } = METER_UNIT[kind];
  const label = unitText(unit);
  return { unit: label, dayUnit: `${label}/${t('unit.day')}`, digits };
}

export const tankUnitLabel = (tankUnit) => unitText(TANK_UNIT[tankUnit]);
