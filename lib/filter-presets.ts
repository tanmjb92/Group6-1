import { z } from 'zod';
import type { FilterState } from './filters';

export interface FilterPreset {
  id: string;
  name: string;
  filters: FilterState;
  createdAt: string;
}

export const PRESETS_KEY = 'todo-app:filter-presets';
type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>;
const filterSchema = z.object({
  search: z.string(),
  priority: z.enum(['all', 'high', 'medium', 'low']),
  tagId: z.union([z.literal('all'), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),
  completion: z.enum(['all', 'incomplete', 'completed']),
  dueDateFrom: z.iso.date().nullable(),
  dueDateTo: z.iso.date().nullable(),
}).strict();
const presetSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'Preset name is required').max(100),
  filters: filterSchema,
  createdAt: z.iso.datetime(),
}).strict();
const presetsSchema = z.array(presetSchema).refine(
  (presets) => new Set(presets.map((preset) => preset.id)).size === presets.length,
);

export function loadPresets(
  storage?: PresetStorage,
  onError?: (message: string) => void,
): FilterPreset[] {
  try {
    const raw = (storage ?? localStorage).getItem(PRESETS_KEY);
    if (!raw) return [];
    return presetsSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to load filter presets', error);
    onError?.('Could not load saved filters. Browser storage is unavailable or contains invalid data.');
    return [];
  }
}

function writePresets(presets: FilterPreset[], storage?: PresetStorage): FilterPreset[] {
  try {
    (storage ?? localStorage).setItem(PRESETS_KEY, JSON.stringify(presets));
    return presets;
  } catch (error) {
    console.error('Failed to write filter presets', error);
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('Could not save preset - storage full');
    }
    throw new Error('Could not update saved filters. Browser storage is unavailable.');
  }
}

export function savePreset(preset: FilterPreset, storage?: PresetStorage): FilterPreset[] {
  const validated = presetSchema.parse(preset);
  return writePresets([...loadPresets(storage), validated], storage);
}

export function deletePreset(id: string, storage?: PresetStorage): FilterPreset[] {
  return writePresets(loadPresets(storage).filter((preset) => preset.id !== id), storage);
}
