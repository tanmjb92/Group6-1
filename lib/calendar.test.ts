import { describe, expect, it } from 'vitest';
import {
  calendarMonthKey,
  formatCalendarMonth,
  generateCalendarGrid,
  groupTodosByDate,
  parseCalendarMonth,
  shiftCalendarMonth,
} from './calendar';
import type { Todo } from './db';

const now = new Date('2026-02-01T16:30:00.000Z');

describe('calendar months', () => {
  it('uses the Singapore month for missing or invalid parameters', () => {
    const boundary = new Date('2026-01-31T16:30:00.000Z');
    for (const raw of [null, '', 'abc', '2026-13', '2026-00', '2026-2']) {
      expect(parseCalendarMonth(raw, boundary)).toEqual({ year: 2026, month: 2 });
    }
    expect(parseCalendarMonth('2028-02', boundary)).toEqual({ year: 2028, month: 2 });
    expect(parseCalendarMonth(null)).toHaveProperty('year');
  });

  it('navigates across year boundaries and formats a month', () => {
    expect(shiftCalendarMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftCalendarMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(calendarMonthKey({ year: 2026, month: 2 })).toBe('2026-02');
    expect(formatCalendarMonth({ year: 2026, month: 2 })).toBe('February 2026');
  });
});

describe('calendar grid', () => {
  it('always creates six Sunday-first weeks with adjacent-month padding', () => {
    const cells = generateCalendarGrid(2026, 2, now);
    expect(cells).toHaveLength(42);
    expect(cells[0].date).toBe('2026-02-01');
    expect(cells[41].date).toBe('2026-03-14');
    expect(cells.filter((cell) => cell.isCurrentMonth)).toHaveLength(28);
    expect(cells.filter((cell) => cell.isToday).map((cell) => cell.date)).toEqual(['2026-02-02']);
    expect(cells[0].isPast).toBe(true);
    expect(cells[1].isPast).toBe(false);
    expect(cells.every((cell, index) => cell.isWeekend === (index % 7 === 0 || index % 7 === 6))).toBe(true);
  });

  it.each([[2028, 2, 29], [2026, 8, 31], [2026, 3, 31]])(
    'handles %i-%i with %i current-month days',
    (year, month, days) => {
      const cells = generateCalendarGrid(year, month, now);
      expect(cells).toHaveLength(42);
      expect(cells.filter((cell) => cell.isCurrentMonth)).toHaveLength(days);
      expect(cells.some((cell) => cell.isToday)).toBe(false);
    },
  );

  it('supports the current month without an explicit clock', () => {
    const month = parseCalendarMonth(null);
    expect(generateCalendarGrid(month.year, month.month)).toHaveLength(42);
  });
});

describe('calendar todo grouping', () => {
  it('uses Singapore dates rather than UTC prefixes and excludes undated todos', () => {
    const todos = [
      { id: 1, due_date: '2026-02-28T16:30:00.000Z' },
      { id: 2, due_date: '2026-03-01T01:00:00.000Z' },
      { id: 3, due_date: null },
    ] as Todo[];
    expect(groupTodosByDate(todos)).toEqual({ '2026-03-01': [todos[0], todos[1]] });
  });
});
