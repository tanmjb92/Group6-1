import { describe, expect, it } from 'vitest';
import {
  formatSingaporeDate,
  fromSingaporeDateTimeLocal,
  getSingaporeDateTimeLocal,
  getSingaporeNow,
  parseDueDate,
} from './timezone';

describe('Singapore timezone helpers', () => {
  it('parses datetime-local values as Singapore wall time', () => {
    expect(fromSingaporeDateTimeLocal('2026-01-15T12:30')).toBe('2026-01-15T04:30:00.000Z');
    expect(fromSingaporeDateTimeLocal('2026-02-30T12:30')).toBeNull();
    expect(fromSingaporeDateTimeLocal('2026-01-15')).toBeNull();
  });

  it('normalizes offset and UTC date inputs without changing their instant', () => {
    expect(parseDueDate('2026-01-15T12:30:00+08:00')?.toISOString()).toBe(
      '2026-01-15T04:30:00.000Z',
    );
    expect(parseDueDate('2026-01-15T04:30:00.000Z')?.toISOString()).toBe(
      '2026-01-15T04:30:00.000Z',
    );
    expect(parseDueDate('invalid')).toBeNull();
  });

  it('formats instants and local input fields in Asia/Singapore', () => {
    const instant = new Date('2026-01-15T04:30:00.000Z');
    expect(formatSingaporeDate(instant)).toBe('2026-01-15 12:30');
    expect(getSingaporeDateTimeLocal(instant)).toBe('2026-01-15T12:30');
  });

  it('returns the supplied instant from the Singapore now helper', () => {
    const now = new Date('2026-01-15T04:30:00.000Z');
    expect(getSingaporeNow(() => now)).toBe(now);
  });
});
