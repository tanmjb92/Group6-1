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
  await expect(page.getByRole('heading', { name: 'Pending (0)' })).toHaveCount(0);
  await expect(page.getByText('No todos yet. Add one above to get started.')).toBeVisible();

  await page.getByLabel('Title').fill('Call dentist');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Call dentist')).toBeVisible();
  await expect(page.getByTestId('priority-badge-medium')).toHaveText('Medium');
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();

  await page.getByRole('checkbox', { name: 'Mark "Call dentist" as complete' }).click();
  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Title').fill('Call the dentist');
  await page.getByRole('dialog').getByLabel('Priority').selectOption('high');
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByText('Call the dentist')).toBeVisible();
  await expect(page.getByTestId('priority-badge-high')).toHaveText('High');

  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Call the dentist')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completed (0)' })).toHaveCount(0);
  await expect(page.getByText('No todos yet. Add one above to get started.')).toBeVisible();
  await cdp.detach();
});

test('shows color-coded priority badges and filters todos by priority', async ({ page }) => {
  const cdp = await register(page, `todo-priority-${Date.now()}`);

  for (const [title, priority, label, background] of [
    ['Urgent proposal', 'high', 'High', /bg-red-100/],
    ['Routine email', 'medium', 'Medium', /bg-yellow-100/],
    ['Read later', 'low', 'Low', /bg-blue-100/],
  ] as const) {
    await page.getByLabel('Title').fill(title);
    await page.locator('form').first().getByRole('combobox').selectOption(priority);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const badge = page.getByTestId(`priority-badge-${priority}`).last();
    await expect(badge).toHaveText(label);
    await expect(badge).toHaveClass(background);
  }
  async function expectPriorityBadgesMeetContrast() {
    const ratios = await page.locator('[data-testid^="priority-badge-"]').evaluateAll((badges) => {
      const context = document.createElement('canvas').getContext('2d');
      if (!context) throw new Error('Canvas 2D context is unavailable');
      const rgb = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const luminance = (color: string) => {
        const [red, green, blue] = rgb(color).map((channel) => {
          const value = Number(channel) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      return badges.map((badge) => {
        const style = getComputedStyle(badge);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
    });
    expect(ratios.every((ratio) => ratio >= 4.5)).toBe(true);
  }
  await expectPriorityBadgesMeetContrast();

  const filter = page.getByLabel('Filter by priority');
  await filter.selectOption('high');
  await expect(page.getByText('Urgent proposal')).toBeVisible();
  await expect(page.getByText('Routine email')).not.toBeVisible();
  await expect(page.getByText('Read later')).not.toBeVisible();
  await filter.selectOption('all');
  await expect(page.getByText('Urgent proposal')).toBeVisible();
  await expect(page.getByText('Routine email')).toBeVisible();
  await expect(page.getByText('Read later')).toBeVisible();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByTestId('priority-badge-high').last()).toHaveClass(/dark:bg-red-950/);
  await expectPriorityBadgesMeetContrast();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('checkbox', { name: 'Mark "Urgent proposal" as complete' }).click();
  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible();
  await filter.selectOption('high');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Priority').selectOption('low');
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByText('Urgent proposal')).not.toBeVisible();
  await filter.selectOption('all');
  await expect(page.getByTestId('priority-badge-low')).toHaveCount(2);
  await cdp.detach();
});

test('validates priority on create and update API calls', async ({ page }) => {
  const cdp = await register(page, `todo-priority-api-${Date.now()}`);
  const invalidCreate = await page.request.post('/api/todos', {
    data: { title: 'Invalid priority', priority: 'urgent' },
  });
  expect(invalidCreate.status()).toBe(400);
  expect(await invalidCreate.json()).toMatchObject({
    error: "Invalid priority: urgent. Must be 'high', 'medium', or 'low'.",
  });
  expect(await (await page.request.get('/api/todos')).json()).toEqual([]);

  const created = await page.request.post('/api/todos', {
    data: { title: 'Medium priority task', priority: null },
  });
  expect(created.status()).toBe(201);
  const todo = (await created.json()) as { id: number; priority: string };
  expect(todo.priority).toBe('medium');

  const invalidUpdate = await page.request.put(`/api/todos/${todo.id}`, {
    data: { priority: null },
  });
  expect(invalidUpdate.status()).toBe(400);
  expect(await invalidUpdate.json()).toMatchObject({
    error: "Invalid priority: null. Must be 'high', 'medium', or 'low'.",
  });
  const filtered = await page.request.get('/api/todos?priority=medium');
  expect(filtered.status()).toBe(200);
  expect(await filtered.json()).toHaveLength(1);
  expect((await page.request.get('/api/todos?priority=urgent')).status()).toBe(400);
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
