import { expect, test, type Page } from '@playwright/test';

async function register(page: Page) {
  await page.goto('/login');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true,
    },
  });
  await page.getByLabel('Username').fill(`templates-${Date.now()}`);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page).toHaveURL('/');
  return cdp;
}

test('saves a draft, uses both entry points, edits, filters, and deletes independent templates', async ({ page }) => {
  const cdp = await register(page);
  await page.getByLabel('Title', { exact: true }).fill('Weekly planning');
  await page.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high');
  await page.getByRole('button', { name: 'Save as Template' }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Template name').fill('Planning');
  await editor.getByLabel('Category', { exact: true }).fill('Work');
  await editor.getByLabel('Description').fill('Weekly checklist');
  await editor.getByLabel('Due-date offset (minutes)').fill('60');
  await editor.getByLabel('Repeat').check();
  await editor.getByLabel('Recurrence pattern').selectOption('weekly');
  await editor.getByRole('button', { name: 'Save Template', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByLabel('Use Template')).toContainText('Planning (Work)');
  await page.getByLabel('Use Template').selectOption({ label: 'Planning (Work)' });
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  const manager = page.getByRole('dialog');
  await expect(manager).toContainText('Weekly checklist');
  await manager.getByLabel('Filter templates by category').selectOption('Work');
  await manager.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(manager).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pending (2)' })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Use Template')).toContainText('Planning (Work)');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Template name').fill('Updated planning');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Template', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Updated planning');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No templates');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pending (2)' })).toBeVisible();
  await cdp.detach();
});

test('template APIs validate input, isolate owners, and support no-date templates', async ({ page, browser }) => {
  const unauthenticated = await browser.newContext();
  for (const [method, path] of [
    ['GET', '/api/templates'], ['POST', '/api/templates'], ['PUT', '/api/templates/1'],
    ['DELETE', '/api/templates/1'], ['POST', '/api/templates/1/use'],
  ]) {
    const response = await unauthenticated.request.fetch(`http://localhost:3101${path}`, {
      method, data: {},
    });
    expect(response.status()).toBe(401);
  }
  await unauthenticated.close();
  const cdp = await register(page);
  for (const data of [
    {}, { name: ' ', title_template: 'Title' },
    { name: 'Bad', title_template: 'Title', subtasks: [{ title: ' ', position: 0 }] },
    { name: 'Bad', title_template: 'Title', reminder_minutes: 16 },
    { name: 'Bad', title_template: 'Title', is_recurring: true },
    { name: 'Bad', title_template: 'Title', due_date_offset_minutes: 0 },
  ]) {
    expect((await page.request.post('/api/templates', { data })).status()).toBe(400);
  }
  const malformed = await page.request.post('/api/templates', {
    data: '{', headers: { 'Content-Type': 'application/json' },
  });
  expect(malformed.status()).toBe(400);
  const response = await page.request.post('/api/templates', {
    data: { name: 'Simple', title_template: 'Simple task' },
  });
  expect(response.status()).toBe(201);
  const template = await response.json();
  expect((await page.request.put(`/api/templates/${template.id}`, {
    data: { description: 'Updated' },
  })).status()).toBe(200);
  const used = await page.request.post(`/api/templates/${template.id}/use`);
  expect(used.status()).toBe(201);
  expect(await used.json()).toMatchObject({
    title: 'Simple task', due_date: null, is_recurring: false, reminder_minutes: null,
  });
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  const otherCdp = await register(otherPage);
  expect(await (await other.request.get('http://localhost:3101/api/templates')).json()).toEqual([]);
  for (const suffix of ['', '/use']) {
    const denied = await other.request.fetch(`http://localhost:3101/api/templates/${template.id}${suffix}`, {
      method: suffix ? 'POST' : 'PUT', data: { name: 'Stolen' },
    });
    expect(denied.status()).toBe(404);
  }
  expect((await other.request.delete(`http://localhost:3101/api/templates/${template.id}`)).status()).toBe(404);
  await otherCdp.detach();
  await other.close();
  await page.request.delete(`/api/templates/${template.id}`);
  expect((await page.request.post(`/api/templates/${template.id}/use`)).status()).toBe(404);
  await cdp.detach();
});

test('captures, edits, and recreates checklist and reminder snapshots', async ({ page }) => {
  const cdp = await register(page);
  await page.getByLabel('Title', { exact: true }).fill('Onboarding');
  await page.getByRole('button', { name: 'Save as Template', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Template name').fill('Full onboarding');
  await editor.getByLabel('Due-date offset (minutes)').fill('120');
  await editor.getByLabel('Reminder timing').selectOption('30');
  await expect(editor.getByLabel('Reminder timing').locator('option')).toHaveCount(8);
  await editor.getByRole('button', { name: 'Add checklist item' }).click();
  await editor.getByLabel('Checklist item 1', { exact: true }).fill('Prepare access');
  await editor.getByRole('button', { name: 'Add checklist item' }).click();
  await editor.getByLabel('Checklist item 2', { exact: true }).fill('Arrange training');
  await editor.getByRole('button', { name: 'Save Template', exact: true }).click();
  await page.getByLabel('Use Template', { exact: true }).selectOption({ label: 'Full onboarding' });
  const todos = await (await page.request.get('/api/todos')).json();
  const todo = todos.find((item: { title: string }) => item.title === 'Onboarding');
  expect(todo.reminder_minutes).toBe(30);
  expect(todo.subtasks.map((item: { title: string; completed: boolean }) => [item.title, item.completed]))
    .toEqual([['Prepare access', false], ['Arrange training', false]]);
  await page.request.put(`/api/subtasks/${todo.subtasks[0].id}`, { data: { completed: true } });
  await page.reload();
  await page.getByRole('button', { name: 'Save "Onboarding" as template' }).click();
  await editor.getByLabel('Template name').fill('Snapshot');
  await expect(editor.getByLabel('Checklist item 1', { exact: true })).toHaveValue('Prepare access');
  await expect(editor.getByLabel('Reminder timing')).toHaveValue('30');
  await editor.getByRole('button', { name: 'Move checklist item 2 up' }).click();
  await editor.getByRole('button', { name: 'Save Template', exact: true }).click();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('30 minutes before');
  await expect(page.getByRole('dialog')).toContainText('Arrange training');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Use Template').selectOption({ label: 'Snapshot' });
  const updated = await (await page.request.get('/api/todos')).json();
  const copy = updated.find((item: { id: number }) => item.id !== todo.id);
  expect(copy.reminder_minutes).toBe(30);
  expect(copy.subtasks.map((item: { title: string; completed: boolean }) => [item.title, item.completed]))
    .toEqual([['Arrange training', false], ['Prepare access', false]]);
  await cdp.detach();
});

test('handles a large library, preserves metadata on partial edits, and creates a checklist in one fast request', async ({ page }) => {
  const cdp = await register(page);
  const subtasks = Array.from({ length: 25 }, (_, position) => ({ title: `Step ${position + 1}`, position }));
  let templateId = 0;
  for (let index = 0; index < 50; index += 1) {
    const response = await page.request.post('/api/templates', {
      data: {
        name: `Library ${index}`, title_template: 'Large checklist', category: 'Work',
        reminder_minutes: 60, due_date_offset_minutes: 120, subtasks,
      },
    });
    expect(response.status()).toBe(201);
    templateId = (await response.json()).id;
  }
  const edited = await page.request.put(`/api/templates/${templateId}`, { data: { description: 'Updated preview' } });
  expect(edited.status()).toBe(200);
  expect(await edited.json()).toMatchObject({ reminder_minutes: 60, subtasks_json: JSON.stringify(subtasks) });
  await page.reload();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  const manager = page.getByRole('dialog');
  await expect(manager.getByRole('heading', { level: 3 })).toHaveCount(50);
  await expect(manager).toContainText('Step 25');
  expect(await manager.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await page.route('**/api/templates/*/use', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Could not create todo' }),
  }));
  await manager.getByRole('button', { name: 'Use', exact: true }).first().click();
  await expect(manager.getByRole('alert')).toHaveText('Could not create todo');
  await page.unroute('**/api/templates/*/use');
  await manager.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByLabel('Checklist item 25', { exact: true })).toHaveValue('Step 25');
  await editor.getByRole('button', { name: 'Remove checklist item 25', exact: true }).click();
  await editor.getByLabel('Reminder timing').selectOption('120');
  await editor.getByRole('button', { name: 'Save Template', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('2 hours before');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

  // Warm the route before measuring the PRP's single-request creation target.
  await page.request.post(`/api/templates/${templateId}/use`);
  const measured = await page.evaluate(async (id) => {
    const before = Date.now();
    const start = performance.now();
    const response = await fetch(`/api/templates/${id}/use`, { method: 'POST' });
    const todo = await response.json();
    return { elapsed: performance.now() - start, status: response.status, todo, before, after: Date.now() };
  }, templateId);
  expect(measured.status).toBe(201);
  expect(measured.elapsed).toBeLessThan(300);
  expect(measured.todo.subtasks).toHaveLength(24);
  expect(measured.todo.reminder_minutes).toBe(120);
  expect(Date.parse(measured.todo.due_date)).toBeGreaterThanOrEqual(measured.before + 120 * 60_000);
  expect(Date.parse(measured.todo.due_date)).toBeLessThanOrEqual(measured.after + 120 * 60_000);
  await cdp.detach();
});
