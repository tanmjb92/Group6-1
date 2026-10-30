import { expect, test, type Page } from '@playwright/test';
import { createDatabase } from '../../lib/db';
import holidays from '../../scripts/singapore-holidays-2026.json';
import { calendarMonthKey, formatCalendarMonth, parseCalendarMonth } from '../../lib/calendar';
import { getSingaporeDateTimeLocal } from '../../lib/timezone';

async function register(page: Page, username = `calendar-${Date.now()}`) {
  await page.goto('/login');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('status')).toHaveCount(0);
  return cdp;
}

test.beforeAll(() => {
  const database = createDatabase('playwright-auth.db');
  try {
    database.holidayDB.upsertAll(holidays);
  } finally {
    database.close();
  }
});

test('calendar is protected and holiday endpoints require authentication', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page).toHaveURL('/login');
  expect((await page.request.get('/api/holidays')).status()).toBe(401);
});

test('navigates months, preserves URL state, and renders seeded holidays', async ({ page }) => {
  const cdp = await register(page);
  const currentMonth = parseCalendarMonth(null);
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: formatCalendarMonth(currentMonth) })).toBeVisible();
  await expect(page.getByRole('table').getByRole('columnheader')).toHaveCount(7);
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(6);
  await expect(page.getByTestId(/^calendar-day-/)).toHaveCount(42);
  const today = getSingaporeDateTimeLocal(new Date()).slice(0, 10);
  await expect(page.getByTestId(`calendar-day-${today}`)).toHaveAttribute('aria-current', 'date');
  await page.goto('/calendar?month=2026-11');
  await expect(page.getByTestId('calendar-day-2026-11-08')).toContainText('Deepavali');
  await page.getByTestId('calendar-day-2026-11-08').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Deepavali');
  await expect(dialog).toContainText('No todos due');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('calendar-day-2026-11-08')).toBeFocused();

  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page).toHaveURL('/calendar?month=2026-10');
  await expect(page.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page).toHaveURL('/calendar?month=2026-11');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'November 2026' })).toBeVisible();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page).toHaveURL(`/calendar?month=${calendarMonthKey(currentMonth)}`);
  await page.goto('/calendar?month=2026-13');
  await expect(page.getByRole('heading', { name: formatCalendarMonth(currentMonth) })).toBeVisible();
  await cdp.detach();
});

test('buckets UTC timestamps into Singapore days and shows overflow in a read-only modal', async ({ page }) => {
  const cdp = await register(page);
  const titles = ['High calendar task', 'Medium calendar task', 'Low calendar task', 'Extra calendar task'];
  for (const [index, title] of titles.entries()) {
    const response = await page.request.post('/api/todos', {
      data: {
        title,
        due_date: '2027-12-31T16:30:00.000Z',
        priority: (['high', 'medium', 'low', 'medium'] as const)[index],
      },
    });
    expect(response.status()).toBe(201);
    if (index === 0) {
      const todo = await response.json();
      expect((await page.request.put(`/api/todos/${todo.id}`, { data: { completed: true } })).ok()).toBe(true);
    }
  }
  await page.request.post('/api/todos', { data: { title: 'Undated calendar task' } });
  await page.goto('/calendar?month=2028-01');
  const cell = page.getByTestId('calendar-day-2028-01-01');
  await expect(cell).toContainText('+1 more');
  await expect(cell.locator('span[title]')).toHaveCount(3);
  await expect(page.getByTestId('calendar-day-2027-12-31')).not.toContainText('calendar task');
  await expect(page.getByText('Undated calendar task')).toHaveCount(0);
  await cell.click();
  const dialog = page.getByRole('dialog');
  for (const title of titles) await expect(dialog.getByText(title, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'High calendar task completed' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'High calendar task completed' })).toBeDisabled();
  await expect(dialog.locator('span.bg-red-100')).toHaveCount(1);
  await expect(dialog.locator('span.bg-yellow-100')).toHaveCount(2);
  await expect(dialog.locator('span.bg-blue-100')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await cdp.detach();
});

test('validates holiday filters and scopes to all visible grid dates', async ({ page }) => {
  const cdp = await register(page);
  const response = await page.request.get('/api/holidays?year=2026&month=5');
  expect(response.ok()).toBe(true);
  const result = await response.json();
  expect(result.holidays).toEqual(expect.arrayContaining([
    expect.objectContaining({ date: '2026-06-01', name: 'Vesak Day (observed for Sunday rest day)' }),
  ]));
  expect(result.holidays.some((holiday: { date: string }) => holiday.date === '2026-08-09')).toBe(false);
  expect((await (await page.request.get('/api/holidays')).json()).holidays.length).toBeGreaterThanOrEqual(14);
  for (const query of ['year=2026', 'month=11', 'year=no&month=11', 'year=2026&month=13', 'year=2026&month=0']) {
    expect((await page.request.get(`/api/holidays?${query}`)).status()).toBe(400);
  }
  await cdp.detach();
});

test('surfaces calendar fetch errors and supports retry', async ({ page }) => {
  const cdp = await register(page);
  await page.route('**/api/holidays?**', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  );
  await page.goto('/calendar?month=2026-11');
  await expect(page.getByRole('alert', { name: 'Calendar error' })).toContainText('503');
  await page.unroute('**/api/holidays?**');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('calendar-day-2026-11-08')).toContainText('Deepavali');
  await expect(page.getByRole('alert', { name: 'Calendar error' })).toHaveCount(0);
  await cdp.detach();
});

test('keeps warmed month navigation and scoped holidays within performance targets', async ({ page }) => {
  const username = `calendar-performance-${Date.now()}`;
  const cdp = await register(page, username);
  const database = createDatabase('playwright-auth.db');
  try {
    const user = database.userDB.findByUsername(username);
    if (!user) throw new Error('Registered calendar test user was not found');
    database.connection.transaction(() => {
      for (let index = 0; index < 499; index += 1) {
        database.todoDB.create(user.id, {
          title: `Performance todo ${index}`,
          due_date: '2028-12-01T01:00:00.000Z',
        });
      }
    })();
  } finally {
    database.close();
  }

  await page.goto('/calendar?month=2028-12');
  await expect(page.getByTestId('calendar-day-2028-12-01')).toContainText('+496 more');
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.getByRole('heading', { name: 'November 2028' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);

  const timing = page.evaluate(() => new Promise<number>((resolve) => {
    const next = document.querySelector<HTMLButtonElement>('[aria-label="Next month"]');
    if (!next) throw new Error('Next month button missing');
    next.addEventListener('click', () => {
      const start = performance.now();
      const observer = new MutationObserver(() => {
        const cell = document.querySelector('[data-testid="calendar-day-2028-12-01"]');
        if (cell?.textContent?.includes('+496 more')) {
          observer.disconnect();
          resolve(performance.now() - start);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }, { once: true });
  }));
  await page.getByRole('button', { name: 'Next month' }).click();
  const navigationMs = await timing;
  expect(navigationMs).toBeLessThan(200);

  const holidayMs = await page.evaluate(async () => {
    const start = performance.now();
    const response = await fetch('/api/holidays?year=2028&month=12');
    if (!response.ok) throw new Error('Holiday timing request failed');
    await response.json();
    return performance.now() - start;
  });
  expect(holidayMs).toBeLessThan(100);
  test.info().annotations.push({
    type: 'performance',
    description: `499 todos: month navigation ${navigationMs.toFixed(1)}ms; holidays ${holidayMs.toFixed(1)}ms`,
  });
  await cdp.detach();
});
