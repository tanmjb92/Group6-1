import { describe, expect, it } from 'vitest';
import { isCounterAdvanceValid } from './counter';

describe('authenticator counter validation', () => {
  it('allows authenticators that always report zero', () => {
    expect(isCounterAdvanceValid(0, 0)).toBe(true);
    expect(isCounterAdvanceValid(undefined, undefined)).toBe(true);
  });

  it('requires an increasing non-zero counter', () => {
    expect(isCounterAdvanceValid(4, 5)).toBe(true);
    expect(isCounterAdvanceValid(4, 4)).toBe(false);
    expect(isCounterAdvanceValid(4, 3)).toBe(false);
  });

  it('allows a transition from zero to a positive counter', () => {
    expect(isCounterAdvanceValid(0, 1)).toBe(true);
  });
});
