import { expect, test, type Page } from '@playwright/test';

async function register(page: Page, username: string) {
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
  return cdp;
}

function singaporeDateTimeLocalAfterDays(days: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + 60 * 60_000));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  const date = new Date(
    Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day')) + days),
  );
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}T${part('hour')}:${part('minute')}`;
}

test('creates a recurring todo and spawns exactly one next occurrence on completion', async ({
  page,
}) => {
  const cdp = await register(page, `todo-recurring-${Date.now()}`);
  const invalid = await page.request.post('/api/todos', {
    data: { title: 'Missing due date', is_recurring: true, recurrence_pattern: 'daily' },
  });
  expect(invalid.status()).toBe(400);

  await page.getByLabel('Title').fill('Weekly review');
  await page.getByLabel('Due date and time (Singapore)').fill(singaporeDateTimeLocalAfterDays(2));
  await page.getByLabel('Repeat').check();
  await page.getByLabel('Recurrence pattern').selectOption('weekly');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('recurrence-badge-weekly')).toHaveCount(1);

  await page.getByRole('checkbox', { name: 'Mark "Weekly review" as complete' }).click();
  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await expect(page.getByTestId('recurrence-badge-weekly')).toHaveCount(2);

  const todosResponse = await page.request.get('/api/todos');
  const todos = (await todosResponse.json()) as Array<{
    id: number;
    title: string;
    completed: boolean;
    due_date: string;
  }>;
  const occurrences = todos.filter((todo) => todo.title === 'Weekly review');
  expect(occurrences).toHaveLength(2);
  const [next] = occurrences.filter((todo) => !todo.completed);
  const [completed] = occurrences.filter((todo) => todo.completed);
  expect(Date.parse(next.due_date) - Date.parse(completed.due_date)).toBe(7 * 24 * 60 * 60_000);

  await page.request.put(`/api/todos/${completed.id}`, { data: { completed: false } });
  const duplicateCompletion = await page.request.put(`/api/todos/${completed.id}`, {
    data: { completed: true },
  });
  expect(duplicateCompletion.ok()).toBe(true);
  expect((await (await page.request.get('/api/todos')).json()).filter(
    (todo: { title: string }) => todo.title === 'Weekly review',
  )).toHaveLength(2);
  await cdp.detach();
});

test('disabling recurrence prevents that todo from spawning another occurrence', async ({ page }) => {
  const cdp = await register(page, `todo-recurring-stop-${Date.now()}`);
  await page.getByLabel('Title').fill('Stop repeating');
  await page.getByLabel('Due date and time (Singapore)').fill(singaporeDateTimeLocalAfterDays(2));
  await page.getByLabel('Repeat').check();
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Repeat').uncheck();
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByTestId('recurrence-badge-daily')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Mark "Stop repeating" as complete' }).click();
  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible();

  const todos = (await (await page.request.get('/api/todos')).json()) as Array<{
    title: string;
  }>;
  expect(todos.filter((todo) => todo.title === 'Stop repeating')).toHaveLength(1);
  await cdp.detach();
});
