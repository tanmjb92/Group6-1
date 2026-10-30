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
  await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();
  return cdp;
}

function singaporeDateTimeLocal(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

test('creates, completes, edits, and deletes todos', async ({ page }) => {
  const cdp = await register(page, `todo-crud-${Date.now()}`);
  await expect(page.getByRole('heading', { name: 'Pending (0)' })).toBeVisible();

  await page.getByLabel('Title').fill('Call dentist');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Call dentist')).toBeVisible();
  await expect(page.getByText('Medium priority')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();

  await page.getByRole('checkbox', { name: 'Mark "Call dentist" as complete' }).click();
  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Title').fill('Call the dentist');
  await page.getByRole('dialog').getByLabel('Priority').selectOption('high');
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByText('Call the dentist')).toBeVisible();
  await expect(page.getByText('High priority')).toBeVisible();

  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Call the dentist')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completed (0)' })).toBeVisible();
  await cdp.detach();
});

test('uses Singapore-local due dates and rejects invalid API input', async ({ page }) => {
  const cdp = await register(page, `todo-date-${Date.now()}`);
  const invalid = await page.request.post('/api/todos', {
    data: { title: 'Too soon', due_date: new Date(Date.now() - 60_000).toISOString() },
  });
  expect(invalid.status()).toBe(400);

  const dueDate = singaporeDateTimeLocal(new Date(Date.now() + 60 * 60_000));
  await page.getByLabel('Title').fill('Submit report');
  await page.getByLabel('Due date and time (Singapore)').fill(dueDate);
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByText('Submit report')).toBeVisible();
  await expect(page.getByText('Pending (1)')).toBeVisible();
  const todos = await page.request.get('/api/todos');
  expect(todos.status()).toBe(200);
  const body = (await todos.json()) as Array<{ due_date: string | null }>;
  expect(body).toHaveLength(1);
  expect(body[0].due_date).toMatch(/Z$/);
  await cdp.detach();
});

test('requires authentication for todo API routes', async ({ page }) => {
  expect((await page.request.get('/api/todos')).status()).toBe(401);
  expect((await page.request.post('/api/todos', { data: { title: 'No session' } })).status()).toBe(
    401,
  );
  expect((await page.request.get('/api/todos/1')).status()).toBe(401);
  expect((await page.request.put('/api/todos/1', { data: { completed: true } })).status()).toBe(401);
  expect((await page.request.delete('/api/todos/1')).status()).toBe(401);
});

test('keeps todos private between authenticated users', async ({ browser, page }) => {
  const firstCdp = await register(page, `todo-owner-${Date.now()}`);
  const created = await page.request.post('/api/todos', {
    data: { title: 'Private task' },
  });
  expect(created.status()).toBe(201);
  const firstTodo = (await created.json()) as { id: number };

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const secondCdp = await register(secondPage, `todo-other-${Date.now()}`);
  const list = await secondPage.request.get('/api/todos');
  expect(await list.json()).toEqual([]);
  expect((await secondPage.request.get(`/api/todos/${firstTodo.id}`)).status()).toBe(404);
  expect(
    (
      await secondPage.request.put(`/api/todos/${firstTodo.id}`, {
        data: { title: 'Attempt to edit' },
      })
    ).status(),
  ).toBe(404);
  expect((await secondPage.request.delete(`/api/todos/${firstTodo.id}`)).status()).toBe(404);

  await firstCdp.detach();
  await secondCdp.detach();
  await secondContext.close();
});
