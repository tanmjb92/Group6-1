import { afterEach, describe, expect, it, vi } from 'vitest';
import { deletePreset, loadPresets, PRESETS_KEY, savePreset, type FilterPreset } from './filter-presets';
import { DEFAULT_FILTER_STATE } from './filters';

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
  };
}
const preset: FilterPreset = {
  id: 'one', name: 'Morning', createdAt: '2026-10-30T08:00:00.000Z',
  filters: { ...DEFAULT_FILTER_STATE, search: 'Review', tagId: 4, dueDateFrom: '2026-11-02' },
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('browser-local filter presets', () => {
  it('round-trips full filter state and deletes one preset', () => {
    const store = storage();
    expect(loadPresets(store)).toEqual([]);
    expect(savePreset(preset, store)).toEqual([preset]);
    expect(savePreset({ ...preset, id: 'two' }, store)).toHaveLength(2);
    expect(loadPresets(store)[0]).toEqual(preset);
    expect(deletePreset('one', store)).toEqual([{ ...preset, id: 'two' }]);
    expect(deletePreset('two', store)).toEqual([]);
    expect(store.getItem).toHaveBeenCalledWith(PRESETS_KEY);
  });
  it.each([
    '{', '{}', 'null', '[null]', '[{}]',
    JSON.stringify([{ ...preset, filters: { ...preset.filters, priority: 'urgent' } }]),
    JSON.stringify([{ ...preset, filters: { ...preset.filters, dueDateTo: '2026-02-30' } }]),
    JSON.stringify([{ ...preset, filters: { ...preset.filters, tagId: -1 } }]),
    JSON.stringify([{ ...preset, createdAt: 'yesterday' }]),
    JSON.stringify([preset, preset]),
  ])('reports malformed storage without crashing: %s', (raw) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const report = vi.fn();
    expect(loadPresets(storage(raw), report)).toEqual([]);
    expect(report).toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });
  it('reports blocked reads and rejects failed writes without success-shaped state', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = storage();
    store.getItem.mockImplementation(() => { throw new Error('blocked'); });
    const report = vi.fn();
    expect(loadPresets(store, report)).toEqual([]);
    expect(report).toHaveBeenCalled();
    store.getItem.mockReturnValue(null);
    store.setItem.mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    expect(() => savePreset(preset, store)).toThrow('storage full');
    expect(() => deletePreset('one', store)).toThrow();
  });
  it('validates new presets before writing', () => {
    const store = storage();
    expect(() => savePreset({ ...preset, name: ' ' }, store)).toThrow();
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('uses browser storage by default and surfaces non-quota write failures', () => {
    const store = storage();
    vi.stubGlobal('localStorage', store);
    expect(savePreset(preset)).toEqual([preset]);
    expect(loadPresets()).toEqual([preset]);
    expect(deletePreset('one')).toEqual([]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    store.setItem.mockImplementation(() => { throw new Error('Storage disabled'); });
    expect(() => savePreset(preset)).toThrow('Browser storage is unavailable');
  });
});
