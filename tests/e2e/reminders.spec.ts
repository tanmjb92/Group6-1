import { expect, test, type Page } from '@playwright/test';

type TestNotification = { title: string; tag?: string };

async function installNotificationMock(page: Page) {
  await page.addInitScript(() => {
    const originalSetInterval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      originalSetInterval(handler, timeout && timeout >= 30_000 ? 100 : timeout, ...args)) as typeof window.setInterval;

    const notifications: TestNotification[] = [];
    Object.defineProperty(window, '__testNotifications', { value: notifications });
    class MockNotification {
      static permission: NotificationPermission = 'default';

      static async requestPermission(): Promise<NotificationPermission> {
        this.permission = 'granted';
        return this.permission;
      }

      constructor(title: string, options?: NotificationOptions) {
        notifications.push({ title, tag: options?.tag });
      }
    }
    Object.defineProperty(window, 'Notification', { value: MockNotification, configurable: true });
  });
}

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

test('offers all reminder presets, disables the control without a due date, and displays badges', async ({ page }) => {
  await installNotificationMock(page);
  const cdp = await register(page, `reminder-presets-${Date.now()}`);
  await expect(page.getByRole('heading', { name: 'Pending (0)' })).toBeVisible();
  const reminder = page.getByLabel('Reminder');
  await expect(reminder).toBeDisabled();
  await expect(reminder.locator('option')).toHaveCount(8);

  await page.getByLabel('Title').fill('Review project');
  await page.getByLabel('Due date and time (Singapore)').fill(
    singaporeDateTimeLocal(new Date(Date.now() + 60 * 60_000)),
  );
  await expect(reminder).toBeEnabled();
  for (const [minutes, abbreviation] of [
    [15, '15m'],
    [30, '30m'],
    [60, '1h'],
    [120, '2h'],
    [1440, '1d'],
    [2880, '2d'],
    [10080, '1w'],
  ] as const) {
    await reminder.selectOption(String(minutes));
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/todos') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const response = await createResponse;
    expect(response.status()).toBe(201);
    const savedTodo = (await response.json()) as { reminder_minutes: number | null };
    expect(savedTodo.reminder_minutes).toBe(minutes);
    await expect(page.getByTestId(`reminder-badge-${minutes}`).last()).toHaveText(`🔔 ${abbreviation}`);
    await page.getByLabel('Title').fill('Review project');
    await page.getByLabel('Due date and time (Singapore)').fill(
      singaporeDateTimeLocal(new Date(Date.now() + 60 * 60_000)),
    );
  }
  await cdp.detach();
});

test('edits reminder timing and clears it when the due date is removed', async ({ page }) => {
  const cdp = await register(page, `reminder-edit-${Date.now()}`);
  await expect(page.getByRole('heading', { name: 'Pending (0)' })).toBeVisible();
  await page.getByLabel('Title').fill('Review design');
  await page.getByLabel('Due date and time (Singapore)').fill(
    singaporeDateTimeLocal(new Date(Date.now() + 60 * 60_000)),
  );
  await page.getByLabel('Reminder').selectOption('60');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('reminder-badge-60')).toHaveText('🔔 1h');

  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reminder').selectOption('120');
  await dialog.getByRole('button', { name: 'Update' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('reminder-badge-120')).toHaveText('🔔 2h');
  let todos = (await (await page.request.get('/api/todos')).json()) as Array<{
    due_date: string | null;
    reminder_minutes: number | null;
  }>;
  expect(todos[0]).toMatchObject({ reminder_minutes: 120 });

  await page.getByRole('button', { name: 'Edit' }).click();
  const editDialog = page.getByRole('dialog');
  await editDialog.getByLabel('Due date and time (Singapore)').fill('');
  await expect(editDialog.getByLabel('Reminder')).toBeDisabled();
  await expect(editDialog.getByLabel('Reminder')).toHaveValue('');
  await editDialog.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByTestId('reminder-badge-120')).toHaveCount(0);
  todos = (await (await page.request.get('/api/todos')).json()) as typeof todos;
  expect(todos[0]).toMatchObject({ due_date: null, reminder_minutes: null });
  await cdp.detach();
});

test('returns due reminders, acknowledges only the matching reminder pair, and rejects tampering', async ({ page }) => {
  await installNotificationMock(page);
  const cdp = await register(page, `reminder-api-${Date.now()}`);
  const dueDate = new Date(Date.now() + 2 * 60_000).toISOString();
  const invalid = await page.request.post('/api/todos', {
    data: { title: 'No date reminder', reminder_minutes: 15 },
  });
  expect(invalid.status()).toBe(400);
  const invalidTiming = await page.request.post('/api/todos', {
    data: { title: 'Invalid reminder', due_date: dueDate, reminder_minutes: 16 },
  });
  expect(invalidTiming.status()).toBe(400);

  const created = await page.request.post('/api/todos', {
    data: { title: 'Send report', due_date: dueDate, reminder_minutes: 15 },
  });
  expect(created.status()).toBe(201);
  const todo = (await created.json()) as { id: number; due_date: string; reminder_minutes: number };
  const check = await page.request.get('/api/notifications/check');
  expect(check.status()).toBe(200);
  expect(await check.json()).toMatchObject({
    success: true,
    data: [{ id: todo.id, due_date: todo.due_date, reminder_minutes: 15 }],
  });

  const staleAck = await page.request.put(`/api/todos/${todo.id}`, {
    data: { notification_ack: { due_date: dueDate, reminder_minutes: 30 } },
  });
  expect(staleAck.status()).toBe(409);
  const staleDueDateAck = await page.request.put(`/api/todos/${todo.id}`, {
    data: {
      notification_ack: {
        due_date: new Date(Date.parse(dueDate) + 60_000).toISOString(),
        reminder_minutes: 15,
      },
    },
  });
  expect(staleDueDateAck.status()).toBe(409);
  const forgedSentAt = await page.request.put(`/api/todos/${todo.id}`, {
    data: { last_notification_sent: new Date().toISOString() },
  });
  expect(forgedSentAt.status()).toBe(400);

  const acknowledged = await page.request.put(`/api/todos/${todo.id}`, {
    data: { notification_ack: { due_date: todo.due_date, reminder_minutes: 15 } },
  });
  expect(acknowledged.status()).toBe(200);
  expect((await acknowledged.json()).last_notification_sent).toBeTruthy();
  expect((await (await page.request.get('/api/notifications/check')).json()).data).toEqual([]);

  const movedDueDate = new Date(Date.now() + 5 * 60_000).toISOString();
  const moved = await page.request.put(`/api/todos/${todo.id}`, {
    data: { due_date: movedDueDate, reminder_minutes: 1440 },
  });
  expect(moved.status()).toBe(200);
  expect((await moved.json()).last_notification_sent).toBeNull();
  expect(
    (await (await page.request.get('/api/notifications/check')).json()).data.map(
      (reminder: { id: number }) => reminder.id,
    ),
  ).toContain(todo.id);
  await cdp.detach();
});

test('requests notification permission only on click, polls while granted, and stops after revocation', async ({ page }) => {
  await installNotificationMock(page);
  const cdp = await register(page, `reminder-delivery-${Date.now()}`);
  const reminderDueDate = new Date(Date.now() + 2 * 60_000).toISOString();
  const created = await page.request.post('/api/todos', {
    data: { title: 'Notify me', due_date: reminderDueDate, reminder_minutes: 15 },
  });
  expect(created.status()).toBe(201);
  const reminderTodo = (await created.json()) as { id: number };
  let checkRequests = 0;
  let acknowledgementAttempts = 0;
  await page.route('**/api/notifications/check', async (route) => {
    checkRequests += 1;
    await route.continue();
  });
  await page.route('**/api/todos/*', async (route) => {
    if (route.request().method() === 'PUT') {
      acknowledgementAttempts += 1;
      if (acknowledgementAttempts === 1) {
        await route.fulfill({ status: 503, body: 'Retry acknowledgement' });
        return;
      }
    }
    await route.continue();
  });

  await expect(page.getByRole('button', { name: /Enable Notifications/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as Window & { __testNotifications: TestNotification[] }).__testNotifications,
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: /Enable Notifications/ }).click();
  await expect(page.getByRole('button', { name: /Notifications On/ })).toBeVisible();
  await expect.poll(async () =>
    page.evaluate(
      () =>
        (window as unknown as Window & { __testNotifications: TestNotification[] })
          .__testNotifications.length,
    ),
  ).toBe(1);
  await expect.poll(() => checkRequests).toBeGreaterThan(1);
  await expect.poll(() => acknowledgementAttempts).toBeGreaterThan(1);
  await expect.poll(async () => (await (await page.request.get('/api/notifications/check')).json()).data).toEqual([]);

  const alternateDueDate = new Date(Date.now() + 10 * 60_000).toISOString();
  const movedForward = await page.request.put(`/api/todos/${reminderTodo.id}`, {
    data: { due_date: alternateDueDate },
  });
  expect(movedForward.status()).toBe(200);
  const movedBack = await page.request.put(`/api/todos/${reminderTodo.id}`, {
    data: { due_date: reminderDueDate },
  });
  expect(movedBack.status()).toBe(200);
  await expect.poll(async () =>
    page.evaluate(
      () =>
        (window as unknown as Window & { __testNotifications: TestNotification[] })
          .__testNotifications.length,
    ),
  ).toBe(2);

  await page.evaluate(() => {
    (window.Notification as unknown as { permission: NotificationPermission }).permission = 'denied';
  });
  await page.waitForTimeout(300);
  const requestCountAfterRevocation = checkRequests;
  await page.waitForTimeout(300);
  expect(checkRequests).toBe(requestCountAfterRevocation);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as Window & { __testNotifications: TestNotification[] })
          .__testNotifications,
    ),
  ).toHaveLength(2);
  await cdp.detach();
});

test('reports polling errors in the notification status', async ({ page }) => {
  await installNotificationMock(page);
  const cdp = await register(page, `reminder-error-${Date.now()}`);
  await page.route('**/api/notifications/check', async (route) => {
    await route.fulfill({ status: 503, body: 'Unavailable' });
  });
  await page.getByRole('button', { name: /Enable Notifications/ }).click();
  await expect(page.getByRole('status')).toContainText(/notification/i);
  await cdp.detach();
});

test('does not poll when permission is denied or notifications are unsupported', async ({ page }) => {
  await installNotificationMock(page);
  const cdp = await register(page, `reminder-denied-${Date.now()}`);
  let checkRequests = 0;
  await page.route('**/api/notifications/check', async (route) => {
    checkRequests += 1;
    await route.continue();
  });
  await page.evaluate(() => {
    const notification = window.Notification as unknown as {
      permission: NotificationPermission;
      requestPermission: () => Promise<NotificationPermission>;
    };
    notification.requestPermission = async () => {
      notification.permission = 'denied';
      return 'denied';
    };
  });
  await page.getByRole('button', { name: /Enable Notifications/ }).click();
  await expect(page.getByRole('button', { name: /Notifications Blocked/ })).toBeVisible();
  await page.waitForTimeout(200);
  expect(checkRequests).toBe(0);
  await cdp.detach();

  const browser = page.context().browser();
  if (!browser) throw new Error('Browser context is unavailable');
  const unsupportedContext = await browser.newContext({
    baseURL: 'http://localhost:3101',
    timezoneId: 'Asia/Singapore',
  });
  const unsupportedPage = await unsupportedContext.newPage();
  await unsupportedPage.addInitScript(() => {
    Object.defineProperty(window, 'Notification', { value: undefined, configurable: true });
  });
  const nextCdp = await register(unsupportedPage, `reminder-unsupported-${Date.now()}`);
  await expect(
    unsupportedPage.getByRole('button', { name: /Notifications Unsupported/ }),
  ).toBeVisible();
  await expect(
    unsupportedPage.getByRole('button', { name: /Notifications Unsupported/ }),
  ).toBeDisabled();
  await nextCdp.detach();
  await unsupportedContext.close();
});

test('requires authentication to check reminders', async ({ page }) => {
  const response = await page.request.get('/api/notifications/check');
  expect(response.status()).toBe(401);
});
