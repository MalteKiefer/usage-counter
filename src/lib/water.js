// Garden share per main-meter interval. Counts only when both meters were read at the same times.
export function pairWater(mainIntervals, gardenReadings) {
  const gardenAt = new Map(gardenReadings.map((r) => [r.read_at, r.meter]));
  return mainIntervals.map((iv) => {
    const from = gardenAt.get(iv.from);
    const to = gardenAt.get(iv.to);
    const garden = from != null && to != null ? to - from : null;
    return { ...iv, garden, house: garden == null ? null : iv.liters - garden };
  });
}
