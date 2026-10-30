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

test('manages tags, assigns multiple tags, filters todos, and deletes tags', async ({ page }) => {
  const cdp = await register(page, `tag-management-${Date.now()}`);
  await page.getByRole('button', { name: 'Manage Tags' }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage Tags' });
  await dialog.getByLabel('Tag name').fill(' Work ');
  await dialog.getByLabel('Tag color').fill('#000000');
  await dialog.getByRole('button', { name: 'Create Tag' }).click();
  await expect(dialog.getByText('Work', { exact: true })).toBeVisible();
  await dialog.getByLabel('Tag name').fill('Work');
  await dialog.getByRole('button', { name: 'Create Tag' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('A tag with this name already exists');
  await dialog.getByLabel('Tag name').fill('Home');
  await dialog.getByRole('button', { name: 'Create Tag' }).click();
  await dialog.getByRole('button', { name: 'Edit Work' }).click();
  await dialog.getByLabel('Edit tag name').fill('Office');
  await dialog.getByLabel('Edit tag color').fill('#FFFF00');
  await dialog.getByRole('button', { name: 'Save Office' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Manage Tags' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByLabel('Title').fill('Tagged proposal');
  await page.getByRole('button', { name: 'Toggle tag Office' }).click();
  await page.getByRole('button', { name: 'Toggle tag Home' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Filter by tag Office' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter by tag Home' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter by tag Office' })).toHaveCSS(
    'background-color',
    'rgb(255, 255, 0)',
  );
  await expect(page.getByRole('button', { name: 'Filter by tag Office' })).toHaveCSS(
    'color',
    'rgb(0, 0, 0)',
  );
  const officeOptionId = await page
    .getByLabel('Filter by tags')
    .locator('option', { hasText: 'Office' })
    .getAttribute('value');
  await page.getByRole('button', { name: 'Filter by tag Office' }).click();
  await expect(page.getByLabel('Filter by tags')).toHaveValue(officeOptionId!);

  await page.getByRole('button', { name: 'Show subtasks for Tagged proposal' }).click();
  await page.getByLabel('Add a subtask to Tagged proposal').fill('Review tagged proposal');
  await page.getByLabel('Add a subtask to Tagged proposal').press('Enter');
  await expect(page.getByLabel('Add a subtask to Tagged proposal')).toHaveValue('');
  await expect(page.getByText('0/1 subtasks')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Toggle tag Home' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Update' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const savedTodos = (await (await page.request.get('/api/todos')).json()) as Array<{
    title: string;
    tags: Array<{ name: string }>;
    subtasks: Array<{ title: string; completed: boolean }>;
  }>;
  expect(savedTodos[0].tags.map((tag) => tag.name)).toEqual(['Office']);
  expect(savedTodos[0].subtasks).toEqual([
    expect.objectContaining({ title: 'Review tagged proposal', completed: false }),
  ]);
  await expect(page.getByText('0/1 subtasks')).toBeVisible();
  await page.getByLabel('Mark subtask "Review tagged proposal" as complete').check();
  await expect(page.getByText('1/1 subtasks')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter by tag Office' })).toBeVisible();

  await page.getByRole('button', { name: 'Manage Tags' }).click();
  const renameDialog = page.getByRole('dialog', { name: 'Manage Tags' });
  await renameDialog.getByRole('button', { name: 'Edit Office' }).click();
  await renameDialog.getByLabel('Edit tag name').fill('Projects');
  await renameDialog.getByLabel('Edit tag color').fill('#FFFF00');
  await renameDialog.getByRole('button', { name: 'Save Projects' }).click();
  await renameDialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Filter by tag Projects' })).toBeVisible();

  await page.getByLabel('Filter by tags').selectOption({ label: 'Projects' });
  await expect(page.getByText('Tagged proposal', { exact: true })).toBeVisible();
  await page.getByLabel('Filter by priority').selectOption('high');
  await expect(page.getByText('Tagged proposal', { exact: true })).not.toBeVisible();
  await page.getByLabel('Filter by priority').selectOption('all');

  await page.getByRole('button', { name: 'Toggle tag Projects' }).click();
  await page.getByRole('button', { name: 'Manage Tags' }).click();
  const manageDialog = page.getByRole('dialog', { name: 'Manage Tags' });
  page.once('dialog', (confirmation) => confirmation.accept());
  await manageDialog.getByRole('button', { name: 'Delete Projects' }).click();
  await expect(page.getByLabel('Filter by tags')).toHaveValue('all');
  await expect(page.getByRole('button', { name: 'Filter by tag Projects' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle tag Projects' })).toHaveCount(0);
  await cdp.detach();
});

test('validates tag APIs, rejects duplicate names, and hides cross-user resources', async ({ page }) => {
  const cdp = await register(page, `tag-api-${Date.now()}`);
  const invalid = await page.request.post('/api/tags', { data: { name: '   ' } });
  expect(invalid.status()).toBe(400);
  const invalidColor = await page.request.post('/api/tags', {
    data: { name: 'Bad color', color: 'red' },
  });
  expect(invalidColor.status()).toBe(400);
  const first = await page.request.post('/api/tags', { data: { name: 'Private' } });
  expect(first.status()).toBe(201);
  const firstTag = (await first.json()) as { id: number; color: string };
  expect(firstTag.color).toBe('#3B82F6');
  expect((await page.request.post('/api/tags', { data: { name: 'Private' } })).status()).toBe(409);
  const second = await page.request.post('/api/tags', { data: { name: 'Another' } });
  const secondTag = (await second.json()) as { id: number };
  const duplicateUpdate = await page.request.put(`/api/tags/${secondTag.id}`, {
    data: { name: 'Private' },
  });
  expect(duplicateUpdate.status()).toBe(409);
  const timings: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const started = Date.now();
    const response = await page.request.post('/api/tags', {
      data: { name: `Measured ${index}` },
    });
    expect(response.status()).toBe(201);
    timings.push(Date.now() - started);
  }
  const getStarted = Date.now();
  const measured = await page.request.get('/api/tags');
  timings.push(Date.now() - getStarted);
  expect(measured.ok()).toBe(true);
  const measuredTags = (await measured.json()) as Array<{ id: number; name: string }>;
  const measuredTag = measuredTags.find((tag) => tag.name === 'Measured 0')!;
  for (const operation of [
    () => page.request.put(`/api/tags/${measuredTag.id}`, { data: { name: 'Measured Updated' } }),
    () => page.request.delete(`/api/tags/${measuredTag.id}`),
  ]) {
    const started = Date.now();
    const response = await operation();
    expect(response.ok()).toBe(true);
    timings.push(Date.now() - started);
  }
  expect(timings.reduce((total, duration) => total + duration, 0) / timings.length).toBeLessThan(300);

  const browser = page.context().browser();
  if (!browser) throw new Error('Browser is not available');
  const otherContext = await browser.newContext({ baseURL: 'http://localhost:3101' });
  const otherPage = await otherContext.newPage();
  const otherCdp = await register(otherPage, `tag-other-${Date.now()}`);
  expect((await otherPage.request.get('/api/tags')).ok()).toBe(true);
  expect(await (await otherPage.request.get('/api/tags')).json()).toEqual([]);
  expect((await otherPage.request.post('/api/tags', {
    data: { name: 'Private' },
  })).status()).toBe(201);
  expect((await otherPage.request.put(`/api/tags/${firstTag.id}`, {
    data: { name: 'Stolen' },
  })).status()).toBe(404);
  expect((await otherPage.request.delete(`/api/tags/${firstTag.id}`)).status()).toBe(404);
  const foreignTodo = await otherPage.request.post('/api/todos', {
    data: { title: 'Cannot use owner tag', tag_ids: [firstTag.id] },
  });
  expect(foreignTodo.status()).toBe(404);

  const todo = await page.request.post('/api/todos', {
    data: { title: 'API todo', tag_ids: [firstTag.id] },
  });
  const todoId = (await todo.json() as { id: number }).id;
  expect((await page.request.post(`/api/todos/${todoId}/tags`, {
    data: { tag_id: firstTag.id },
  })).ok()).toBe(true);
  expect((await page.request.post(`/api/todos/${todoId}/tags`, {
    data: { tag_id: firstTag.id },
  })).ok()).toBe(true);
  expect((await otherPage.request.post(`/api/todos/${todoId}/tags`, {
    data: { tag_id: firstTag.id },
  })).status()).toBe(404);
  expect((await page.request.delete(`/api/todos/${todoId}/tags`, {
    data: { tag_id: firstTag.id },
  })).ok()).toBe(true);
  expect((await page.request.delete(`/api/todos/${todoId}/tags`, {
    data: { tag_id: firstTag.id },
  })).ok()).toBe(true);
  const cleared = await page.request.put(`/api/todos/${todoId}`, {
    data: { tag_ids: [firstTag.id] },
  });
  expect((await cleared.json() as { tags: unknown[] }).tags).toHaveLength(1);
  await otherCdp.detach();
  await otherContext.close();
  await cdp.detach();
});

test('requires authentication for tag endpoints', async ({ request }) => {
  const responses = await Promise.all([
    request.get('/api/tags'),
    request.post('/api/tags', { data: { name: 'Unauthorized' } }),
    request.put('/api/tags/1', { data: { name: 'Unauthorized' } }),
    request.delete('/api/tags/1'),
    request.post('/api/todos/1/tags', { data: { tag_id: 1 } }),
    request.delete('/api/todos/1/tags', { data: { tag_id: 1 } }),
  ]);
  expect(responses.map((response) => response.status())).toEqual(Array(6).fill(401));
});
