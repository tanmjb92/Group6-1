'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Holiday, Priority, Todo } from '@/lib/db';
import {
  calendarMonthKey,
  formatCalendarMonth,
  generateCalendarGrid,
  groupTodosByDate,
  parseCalendarMonth,
  shiftCalendarMonth,
  type CalendarMonth,
} from '@/lib/calendar';
import { formatSingaporeDate, getSingaporeNow } from '@/lib/timezone';

const PRIORITY_STYLES: Record<Priority, string> = {
  high: 'border-red-300 bg-red-100 text-red-800',
  medium: 'border-yellow-300 bg-yellow-100 text-yellow-900',
  low: 'border-blue-300 bg-blue-100 text-blue-800',
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function fetchCalendarData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load calendar data (${response.status}). Please try again.`);
  return response.json();
}

function DayTodosModal({
  date,
  todos,
  holiday,
  onClose,
}: {
  date: string;
  todos: Todo[];
  holiday?: Holiday;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="day-detail-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto max-h-[85vh] w-[min(90vw,36rem)] overflow-y-auto rounded-xl border border-gray-300 p-0 shadow-xl backdrop:bg-black/40"
    >
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="day-detail-title" className="text-xl font-semibold">Todos for {date}</h2>
          <button type="button" onClick={onClose} autoFocus className="rounded border px-3 py-1">
            Close
          </button>
        </div>
        {holiday && <p className="rounded bg-purple-100 p-2 text-purple-900">{holiday.name}</p>}
        {todos.length === 0 ? (
          <p>No todos due on this day.</p>
        ) : (
          <ul className="space-y-3">
            {todos.map((todo) => (
              <li key={todo.id} className="flex items-start gap-3 rounded border border-gray-200 p-3">
                <input type="checkbox" checked={todo.completed} disabled aria-label={`${todo.title} completed`} />
                <div className="min-w-0">
                  <p className={`break-words ${todo.completed ? 'text-gray-500 line-through' : ''}`}>{todo.title}</p>
                  <span className={`mr-2 inline-block rounded border px-2 py-0.5 text-xs ${PRIORITY_STYLES[todo.priority]}`}>
                    {todo.priority}
                  </span>
                  {todo.due_date && <time dateTime={todo.due_date} className="text-sm text-gray-600">{formatSingaporeDate(new Date(todo.due_date))} SGT</time>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}

function CalendarMonthView({ month, now }: { month: CalendarMonth; now: Date }) {
  const router = useRouter();
  const [data, setData] = useState<{ todos: Todo[]; holidays: Holiday[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { year, month: monthNumber } = month;
  const cells = useMemo(() => generateCalendarGrid(year, monthNumber, now), [year, monthNumber, now]);
  const groupedTodos = useMemo(() => groupTodosByDate(data?.todos ?? []), [data]);
  const holidaysByDate = useMemo(
    () => new Map(data?.holidays.map((holiday) => [holiday.date, holiday])),
    [data],
  );

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchCalendarData<Todo[]>('/api/todos', controller.signal),
      fetchCalendarData<{ holidays: Holiday[] }>(
        `/api/holidays?year=${year}&month=${monthNumber}`,
        controller.signal,
      ),
    ])
      .then(([todos, result]) => {
        if (!controller.signal.aborted) {
          setData({ todos, holidays: result.holidays });
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Could not load calendar data.');
        }
      });
    return () => controller.abort();
  }, [year, monthNumber, attempt]);

  function navigate(nextMonth: CalendarMonth) {
    router.replace(`/calendar?month=${calendarMonthKey(nextMonth)}`, { scroll: false });
  }

  return (
    <>
      <div className="my-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold" aria-live="polite">{formatCalendarMonth(month)}</h2>
        <nav aria-label="Calendar navigation" className="flex gap-2">
          <button type="button" aria-label="Previous month" onClick={() => navigate(shiftCalendarMonth(month, -1))} className="rounded border bg-white px-3 py-2">Previous</button>
          <button type="button" onClick={() => navigate(parseCalendarMonth(null))} className="rounded border bg-white px-3 py-2">Today</button>
          <button type="button" aria-label="Next month" onClick={() => navigate(shiftCalendarMonth(month, 1))} className="rounded border bg-white px-3 py-2">Next</button>
        </nav>
      </div>
      {error && (
        <div role="alert" aria-label="Calendar error" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">
          {error}
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="ml-3 underline">Retry</button>
        </div>
      )}
      {!data && !error && <p role="status" className="mb-4">Loading calendar...</p>}
      <p className="mb-3 text-sm text-gray-600">All due-dated todos, in Singapore time. Select a day for details.</p>
      <div className="overflow-x-auto">
        <table aria-label={formatCalendarMonth(month)} className="w-full min-w-[42rem] table-fixed border-collapse bg-white">
          <thead>
            <tr>{WEEKDAYS.map((day) => <th key={day} scope="col" className="border border-gray-200 p-2 text-sm">{day}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, week) => (
              <tr key={week}>
                {cells.slice(week * 7, week * 7 + 7).map((day) => {
                  const todos = groupedTodos[day.date] ?? [];
                  const holiday = holidaysByDate.get(day.date);
                  return (
                    <td
                      key={day.date}
                      className={`h-40 border border-gray-200 p-0 align-top ${day.isWeekend ? 'bg-purple-50' : ''} ${!day.isCurrentMonth ? 'bg-gray-100 text-gray-500' : ''}`}
                    >
                      <button
                        type="button"
                        data-testid={`calendar-day-${day.date}`}
                        aria-label={`${day.date}, ${todos.length} todos${holiday ? `, ${holiday.name}` : ''}`}
                        aria-current={day.isToday ? 'date' : undefined}
                        onClick={() => setSelectedDate(day.date)}
                        className={`flex h-40 w-full flex-col gap-1 overflow-hidden p-2 text-left hover:ring-2 hover:ring-inset hover:ring-purple-400 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-700 ${day.isToday ? 'ring-2 ring-inset ring-purple-700' : ''}`}
                      >
                        <span className={`text-sm font-semibold ${day.isPast && day.isCurrentMonth ? 'text-gray-500' : ''}`}>{Number(day.date.split('-').at(-1))}</span>
                        {holiday && <span className="w-full truncate rounded bg-purple-100 px-1 text-xs font-medium text-purple-900" title={holiday.name}>{holiday.name}</span>}
                        {todos.slice(0, 3).map((todo) => (
                          <span key={todo.id} className={`w-full truncate rounded border px-1 text-xs ${PRIORITY_STYLES[todo.priority]} ${todo.completed ? 'line-through' : ''}`} title={`${todo.title} (${todo.priority}${todo.completed ? ', completed' : ''})`}>{todo.title}</span>
                        ))}
                        {todos.length > 3 && <span className="text-xs font-medium text-purple-800">+{todos.length - 3} more</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedDate && (
        <DayTodosModal
          date={selectedDate}
          todos={groupedTodos[selectedDate] ?? []}
          holiday={holidaysByDate.get(selectedDate)}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </>
  );
}

export default function CalendarView({ initialNow }: { initialNow: string }) {
  const searchParams = useSearchParams();
  const [now, setNow] = useState(() => new Date(initialNow));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(getSingaporeNow()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const month = parseCalendarMonth(searchParams.get('month'), now);
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">Calendar</h1>
        <Link href="/" className="text-purple-800 underline">Back to todos</Link>
      </header>
      <CalendarMonthView key={calendarMonthKey(month)} month={month} now={now} />
    </main>
  );
}
