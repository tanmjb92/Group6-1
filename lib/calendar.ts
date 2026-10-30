import type { Todo } from './db';
import { getSingaporeDateTimeLocal, getSingaporeNow } from './timezone';

export interface CalendarMonth {
  year: number;
  month: number;
}

export interface CalendarDay {
  date: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
}

function calendarDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function dateKey(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function parseCalendarMonth(
  raw: string | null,
  now: Date = getSingaporeNow(),
): CalendarMonth {
  if (raw && /^\d{4,6}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split('-').map(Number);
    if (month >= 1 && month <= 12 && year <= 275759) return { year, month };
  }
  const [year, month] = getSingaporeDateTimeLocal(now).slice(0, 7).split('-').map(Number);
  return { year, month };
}

export function calendarMonthKey({ year, month }: CalendarMonth): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function shiftCalendarMonth(current: CalendarMonth, offset: number): CalendarMonth {
  const date = calendarDate(current.year, current.month + offset, 1);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function formatCalendarMonth(month: CalendarMonth): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
  }).format(calendarDate(month.year, month.month, 1));
}

export function generateCalendarGrid(
  year: number,
  month: number,
  now: Date = getSingaporeNow(),
): CalendarDay[] {
  const firstDay = calendarDate(year, month, 1);
  const today = getSingaporeDateTimeLocal(now).slice(0, 10);
  return Array.from({ length: 42 }, (_, index) => {
    const date = calendarDate(year, month, index - firstDay.getUTCDay() + 1);
    const key = dateKey(date);
    return {
      date: key,
      isCurrentMonth: date.getUTCMonth() + 1 === month,
      isToday: key === today,
      isPast: key < today,
      isWeekend: index % 7 === 0 || index % 7 === 6,
    };
  });
}

export function groupTodosByDate(todos: Todo[]): Record<string, Todo[]> {
  return todos.reduce<Record<string, Todo[]>>((grouped, todo) => {
    if (!todo.due_date) return grouped;
    const key = getSingaporeDateTimeLocal(new Date(todo.due_date)).slice(0, 10);
    grouped[key] = [...(grouped[key] ?? []), todo];
    return grouped;
  }, {});
}
