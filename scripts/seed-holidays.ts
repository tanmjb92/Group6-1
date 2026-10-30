import { db, holidayDB } from '../lib/db';
import holidays from './singapore-holidays-2026.json';

try {
  holidayDB.upsertAll(holidays);
  process.stdout.write(`Seeded ${holidays.length} Singapore holiday dates for 2026.\n`);
} finally {
  db.close();
}
