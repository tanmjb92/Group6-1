import { describe, expect, it } from 'vitest';
import { getTagTextColor, validateCreateTag, validateUpdateTag } from './tag-input';

describe('tag input validation', () => {
  it('trims names and supplies the default color', () => {
    expect(validateCreateTag({ name: '  Work  ' })).toEqual({
      success: true,
      data: { name: 'Work', color: '#3B82F6' },
    });
  });

  it('accepts a valid custom color and rejects unknown properties', () => {
    expect(validateCreateTag({ name: 'Work', color: '#abcdef' })).toEqual({
      success: true,
      data: { name: 'Work', color: '#abcdef' },
    });
    expect(validateCreateTag({ name: 'Work', extra: true })).toMatchObject({
      success: false,
      error: 'Invalid tag data',
    });
  });

  it.each(['', '   ', null, 123])('rejects invalid tag names: %s', (name) => {
    expect(validateCreateTag({ name }).success).toBe(false);
  });

  it.each(['red', '#ZZZ', '#12345', '#12345678'])('rejects invalid colors: %s', (color) => {
    expect(validateCreateTag({ name: 'Work', color }).success).toBe(false);
  });

  it('validates partial updates and rejects empty update payloads', () => {
    expect(validateUpdateTag({ color: '#abcdef' })).toEqual({
      success: true,
      data: { color: '#abcdef' },
    });
    expect(validateUpdateTag({ name: '  ' }).success).toBe(false);
    expect(validateUpdateTag({}).success).toBe(false);
    expect(validateUpdateTag({ name: 'Renamed' })).toEqual({
      success: true,
      data: { name: 'Renamed' },
    });
    expect(validateUpdateTag({ color: 'blue' })).toMatchObject({
      success: false,
      error: 'Color must be a valid hex code',
    });
    expect(validateUpdateTag(null)).toMatchObject({
      success: false,
      error: 'Invalid tag data',
    });
  });

  it.each(['#000000', '#FFFFFF', '#3B82F6', '#FFFF00', '#800080'])(
    'chooses a foreground color with WCAG AA contrast for %s',
    (background) => {
      const foreground = getTagTextColor(background);
      const ratio = contrastRatio(foreground, background);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    },
  );
});

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => {
      const value = Number.parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const light = luminance(foreground);
  const dark = luminance(background);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}
