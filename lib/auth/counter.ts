export function isCounterAdvanceValid(
  storedCounter: number | undefined,
  newCounter: number | undefined,
): boolean {
  const stored = storedCounter ?? 0;
  const next = newCounter ?? 0;
  return stored === 0 && next === 0 ? true : next > stored;
}
