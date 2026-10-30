import { describe, expect, it } from 'vitest';
import { calculateNextDueDate } from './recurrence';

describe('calculateNextDueDate', () => {
  it.each([
    ['daily', '2025-11-10T06:00:00.000Z', '2025-11-11T06:00:00.000Z'],
    ['weekly', '2025-11-10T06:00:00.000Z', '2025-11-17T06:00:00.000Z'],
    ['monthly', '2025-06-15T01:00:00.000Z', '2025-07-15T01:00:00.000Z'],
    ['monthly', '2025-01-31T01:00:00.000Z', '2025-02-28T01:00:00.000Z'],
    ['monthly', '2024-01-31T01:00:00.000Z', '2024-02-29T01:00:00.000Z'],
    ['monthly', '2025-12-31T01:00:00.000Z', '2026-01-31T01:00:00.000Z'],
    ['yearly', '2025-06-15T01:00:00.000Z', '2026-06-15T01:00:00.000Z'],
    ['yearly', '2024-02-29T01:00:00.000Z', '2025-02-28T01:00:00.000Z'],
  ] as const)('%s: calculates %s as %s in Singapore time', (pattern, current, expected) => {
    expect(calculateNextDueDate(current, pattern)).toBe(expected);
  });

  it('preserves the Singapore-local time of day', () => {
    expect(calculateNextDueDate('2025-11-10T14:00:00.000Z', 'daily')).toBe(
      '2025-11-11T14:00:00.000Z',
    );
  });

  it('rejects invalid current due dates', () => {
    expect(() => calculateNextDueDate('not-a-date', 'daily')).toThrow(
      'Current due date must be valid',
    );
  });
});
