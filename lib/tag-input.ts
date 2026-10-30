import { z } from 'zod';
import type { CreateTagInput, UpdateTagInput } from './db';

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const createTagSchema = z
  .object({
    name: z.string(),
    color: hexColorSchema.optional(),
  })
  .strict();
const updateTagSchema = z
  .object({
    name: z.string().optional(),
    color: hexColorSchema.optional(),
  })
  .strict();

export type TagValidation<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export function validateCreateTag(input: unknown): TagValidation<CreateTagInput> {
  const parsed = createTagSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error:
        typeof input === 'object' && input !== null && 'color' in input
          ? 'Color must be a valid hex code'
          : 'Invalid tag data',
    };
  }
  const name = parsed.data.name.trim();
  if (!name) return { success: false, error: 'Tag name is required' };
  return {
    success: true,
    data: { name, color: parsed.data.color ?? '#3B82F6' },
  };
}

export function validateUpdateTag(input: unknown): TagValidation<UpdateTagInput> {
  const parsed = updateTagSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error:
        typeof input === 'object' && input !== null && 'color' in input
          ? 'Color must be a valid hex code'
          : 'Invalid tag data',
    };
  }
  if (Object.keys(parsed.data).length === 0) {
    return { success: false, error: 'At least one field is required' };
  }
  const data: UpdateTagInput = {};
  if (parsed.data.name !== undefined) {
    data.name = parsed.data.name.trim();
    if (!data.name) return { success: false, error: 'Tag name is required' };
  }
  if (parsed.data.color !== undefined) data.color = parsed.data.color;
  return { success: true, data };
}

function relativeLuminance(color: string): number {
  const channels = color
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => {
      const value = Number.parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function getTagTextColor(background: string): '#000000' | '#FFFFFF' {
  const luminance = relativeLuminance(background);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF';
}
