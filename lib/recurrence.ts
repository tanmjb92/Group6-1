import type { RecurrencePattern } from './db';
import { fromSingaporeDateTimeLocal, getSingaporeDateTimeLocal } from './timezone';

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formattedDate(year: number, month: number, day: number, time: string): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${time}`;
}

export function calculateNextDueDate(
  currentDueDate: string,
  pattern: RecurrencePattern,
): string {
  const instant = new Date(currentDueDate);
  if (Number.isNaN(instant.getTime())) throw new Error('Current due date must be valid');

  const localDateTime = getSingaporeDateTimeLocal(instant);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(localDateTime);
  if (!match) throw new Error('Current due date must be valid');

  let year = Number(match[1]);
  let month = Number(match[2]);
  let day = Number(match[3]);
  const time = match[4];

  if (pattern === 'daily' || pattern === 'weekly') {
    const daysToAdd = pattern === 'daily' ? 1 : 7;
    const nextDate = new Date(Date.UTC(year, month - 1, day + daysToAdd));
    year = nextDate.getUTCFullYear();
    month = nextDate.getUTCMonth() + 1;
    day = nextDate.getUTCDate();
  } else if (pattern === 'monthly') {
    month = month === 12 ? 1 : month + 1;
    if (month === 1) year += 1;
    day = Math.min(day, daysInMonth(year, month));
  } else {
    year += 1;
    day = Math.min(day, daysInMonth(year, month));
  }

  const nextDate = fromSingaporeDateTimeLocal(formattedDate(year, month, day, time));
  if (!nextDate) throw new Error('Could not calculate next due date');
  return nextDate;
}
