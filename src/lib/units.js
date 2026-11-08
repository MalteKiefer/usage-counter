// Units per meter kind. The day unit is built from the translated word for "day".
const SPEC = {
  oil: { unit: 'L', digits: 1 },
  water: { unit: 'm³', digits: 3 },
  power: { unit: 'kWh', digits: 1 },
};

export function unitsFor(kind, t) {
  const { unit, digits } = SPEC[kind];
  return { unit, dayUnit: `${unit}/${t('unit.day')}`, digits };
}
