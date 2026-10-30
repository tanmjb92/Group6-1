import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from './db';

describe('holiday database', () => {
  let database: ReturnType<typeof createDatabase> | undefined;
  afterEach(() => database?.close());

  it('seeds idempotently and updates names without duplicating dates', () => {
    database = createDatabase(':memory:');
    database.holidayDB.upsertAll([{ date: '2026-01-01', name: 'New Year' }]);
    database.holidayDB.upsertAll([{ date: '2026-01-01', name: "New Year's Day" }]);
    expect(database.holidayDB.findAll()).toEqual([
      { id: expect.any(Number), date: '2026-01-01', name: "New Year's Day" },
    ]);
  });

  it('includes the full visible calendar range, but no dates outside it', () => {
    database = createDatabase(':memory:');
    database.holidayDB.upsertAll([
      { date: '2026-01-31', name: 'Before grid' },
      { date: '2026-02-01', name: 'Grid start' },
      { date: '2026-03-14', name: 'Grid end' },
      { date: '2026-03-15', name: 'After grid' },
    ]);
    expect(database.holidayDB.findByMonth(2026, 2).map((holiday) => holiday.name)).toEqual([
      'Grid start', 'Grid end',
    ]);
  });
});
