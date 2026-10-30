import { describe, expect, it } from 'vitest';
import { REMINDER_LABELS, REMINDER_PRESETS } from './reminder-options';

describe('reminder options', () => {
  it('exposes all supported offsets and display labels', () => {
    expect(REMINDER_PRESETS).toEqual([15, 30, 60, 120, 1440, 2880, 10080]);
    expect(REMINDER_PRESETS.map((minutes) => REMINDER_LABELS[minutes])).toEqual([
      '15m',
      '30m',
      '1h',
      '2h',
      '1d',
      '2d',
      '1w',
    ]);
  });
});
