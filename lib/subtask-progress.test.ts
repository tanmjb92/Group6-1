import { describe, expect, it } from 'vitest';
import { calculateProgress } from './subtask-progress';
import type { Subtask } from './db';

function subtasks(completedCount: number, total: number): Subtask[] {
  return Array.from({ length: total }, (_, index) => ({
    id: index + 1,
    todo_id: 1,
    title: `Subtask ${index + 1}`,
    completed: index < completedCount,
    position: index,
    created_at: '2026-10-30T00:00:00.000Z',
  }));
}

describe('calculateProgress', () => {
  it('returns zero progress for an empty list', () => {
    expect(calculateProgress([])).toEqual({ completed: 0, total: 0, percent: 0 });
  });

  it('calculates partial progress with rounded percentages', () => {
    expect(calculateProgress(subtasks(3, 7))).toEqual({ completed: 3, total: 7, percent: 43 });
    expect(calculateProgress(subtasks(1, 3)).percent).toBe(33);
    expect(calculateProgress(subtasks(2, 3)).percent).toBe(67);
  });

  it('returns 100 percent when all subtasks are complete', () => {
    expect(calculateProgress(subtasks(4, 4))).toEqual({ completed: 4, total: 4, percent: 100 });
  });

  it('does not mutate the input list', () => {
    const items = subtasks(1, 2);
    const original = structuredClone(items);

    calculateProgress(items);

    expect(items).toEqual(original);
  });
});