const SINGAPORE_TIME_ZONE = 'Asia/Singapore';

export function getSingaporeNow(now: () => Date = () => new Date()): Date {
  return now();
}

export function parseDueDate(value: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0'] = match;
  const calendarDate = new Date(
    Date.UTC(
      Number(yearText),
      Number(monthText) - 1,
      Number(dayText),
      Number(hourText),
      Number(minuteText),
      Number(secondText),
    ),
  );
  if (
    Number(monthText) < 1 ||
    Number(monthText) > 12 ||
    calendarDate.getUTCFullYear() !== Number(yearText) ||
    calendarDate.getUTCMonth() + 1 !== Number(monthText) ||
    calendarDate.getUTCDate() !== Number(dayText) ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59
  ) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function fromSingaporeDateTimeLocal(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  const instant = new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
  const singaporeParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SINGAPORE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: string) => singaporeParts.find((item) => item.type === type)?.value;
  if (
    Number(part('year')) !== year ||
    Number(part('month')) !== month ||
    Number(part('day')) !== day ||
    Number(part('hour')) !== hour ||
    Number(part('minute')) !== minute
  ) {
    return null;
  }

  return instant.toISOString();
}

export function formatSingaporeDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SINGAPORE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

export function getSingaporeDateTimeLocal(date: Date): string {
  return formatSingaporeDate(date).replace(' ', 'T');
}
