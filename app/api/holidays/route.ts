import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { holidayDB } from '@/lib/db';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const year = params.get('year');
  const month = params.get('month');
  if (year === null && month === null) {
    return NextResponse.json({ holidays: holidayDB.findAll() });
  }
  if (
    year === null ||
    month === null ||
    !/^\d{1,6}$/.test(year) ||
    !/^\d{1,2}$/.test(month) ||
    Number(year) > 275759 ||
    Number(month) < 1 ||
    Number(month) > 12
  ) {
    return NextResponse.json({ error: 'Provide a valid year and month (1-12)' }, { status: 400 });
  }
  return NextResponse.json({ holidays: holidayDB.findByMonth(Number(year), Number(month)) });
}
