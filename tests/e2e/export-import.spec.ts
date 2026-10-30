import { readFile } from 'node:fs/promises';
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

async function createTodo(page: Page, title: string, tagIds: number[] = []) {
  const response = await page.request.post('/api/todos', {
    data: { title, priority: 'high', tag_ids: tagIds },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: number };
}

test('exports and restores todos with subtasks and tags, remapping IDs on every import', async ({
  page,
}) => {
  const cdp = await register(page, `export-roundtrip-${Date.now()}`);
  const createdTag = await page.request.post('/api/tags', {
    data: { name: 'Work', color: '#123456' },
  });
  expect(createdTag.status()).toBe(201);
  const tag = (await createdTag.json()) as { id: number; name: string; color: string };
  const original = await createTodo(page, 'Quarterly review', [tag.id]);
  const createdSubtask = await page.request.post(`/api/todos/${original.id}/subtasks`, {
    data: { title: 'Review launch notes' },
  });
  expect(createdSubtask.status()).toBe(201);
  const subtask = (await createdSubtask.json()) as { id: number; todo_id: number };
  expect(
    (
      await page.request.put(`/api/subtasks/${subtask.id}`, {
        data: { completed: true },
      })
    ).ok(),
  ).toBe(true);

  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toMatch(/^todos-\d{4}-\d{2}-\d{2}\.json$/);
  const exportedText = await readFile((await jsonDownload.path())!, 'utf8');
  const exported = JSON.parse(exportedText) as {
    version: number;
    exported_at: string;
    todos: Array<Record<string, unknown> & {
      subtasks: Array<{ title: string; completed: boolean; position: number }>;
      tags: Array<{ name: string; color: string }>;
    }>;
  };
  expect(exported.version).toBe(1);
  expect(exported.exported_at).toBeTruthy();
  expect(exported.todos).toHaveLength(1);
  expect(exported.todos[0]).not.toHaveProperty('id');
  expect(exported.todos[0]).not.toHaveProperty('user_id');
  expect(exported.todos[0].subtasks).toEqual([
    expect.objectContaining({ title: 'Review launch notes', completed: true, position: 0 }),
  ]);
  expect(exported.todos[0].tags).toEqual([{ name: 'Work', color: '#123456' }]);

  expect((await page.request.delete(`/api/todos/${original.id}`)).ok()).toBe(true);
  await page.getByLabel('Import JSON file').setInputFiles({
    name: jsonDownload.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(exportedText),
  });
  await expect(page.getByRole('status')).toHaveText('Successfully imported 1 todos');
  await expect(page.getByText('Quarterly review', { exact: true })).toBeVisible();
  await expect(page.getByText('1/1 subtasks')).toBeVisible();
  const restored = (await (await page.request.get('/api/todos')).json()) as Array<{
    id: number;
    title: string;
    subtasks: Array<{ id: number; todo_id: number; completed: boolean }>;
    tags: Array<{ id: number; name: string }>;
  }>;
  expect(restored).toHaveLength(1);
  expect(restored[0].id).not.toBe(original.id);
  expect(restored[0].subtasks[0]).toMatchObject({ completed: true, todo_id: restored[0].id });
  expect(restored[0].subtasks[0].id).not.toBe(subtask.id);
  expect(restored[0].tags).toEqual([expect.objectContaining({ name: 'Work', id: tag.id })]);

  await page.getByLabel('Import JSON file').setInputFiles({
    name: 'duplicate.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exportedText),
  });
  await expect(page.getByRole('status')).toHaveText('Successfully imported 1 todos');
  const duplicated = (await (await page.request.get('/api/todos')).json()) as Array<{
    title: string;
  }>;
  expect(duplicated.filter((todo) => todo.title === 'Quarterly review')).toHaveLength(2);
  await cdp.detach();
});

test('exports RFC 4180 CSV and reports invalid import files', async ({ page }) => {
  const cdp = await register(page, `export-csv-${Date.now()}`);
  const title = 'Buy milk, eggs, "bread"\nand tea';
  await createTodo(page, title);

  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/^todos-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile((await csvDownload.path())!, 'utf8');
  expect(csv.split('\r\n')[0]).toBe(
    'ID,Title,Completed,Due Date,Priority,Recurring,Pattern,Reminder',
  );
  expect(csv).toContain('"Buy milk, eggs, ""bread""\nand tea",false,,high,false,,');

  await page.getByLabel('Import JSON file').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{not json'),
  });
  await expect(page.locator('p[role="alert"]')).toHaveText('Invalid JSON format');
  await page.getByLabel('Import JSON file').setInputFiles({
    name: 'invalid-encoding.json',
    mimeType: 'application/json',
    buffer: Buffer.from([0xff]),
  });
  await expect(page.locator('p[role="alert"]')).toHaveText('Invalid JSON format');
  await page.getByLabel('Import JSON file').setInputFiles({
    name: 'wrong-shape.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, todos: [] })),
  });
  await expect(page.locator('p[role="alert"]')).toHaveText(
    'Failed to import todos. Please check the file format.',
  );
  await cdp.detach();
});

test('requires authentication for export and import endpoints', async ({ page }) => {
  expect((await page.request.get('/api/todos/export?format=json')).status()).toBe(401);
  expect((await page.request.post('/api/todos/import', { data: {} })).status()).toBe(401);
});

test('scopes exports to their owner and assigns imports to the importing account', async ({
  browser,
  page,
}) => {
  const ownerCdp = await register(page, `export-owner-${Date.now()}`);
  const ownerTodo = await createTodo(page, 'Owner-only task');
  const ownerExportResponse = await page.request.get('/api/todos/export?format=json');
  expect(ownerExportResponse.ok()).toBe(true);
  const ownerExport = (await ownerExportResponse.json()) as {
    version: 1;
    exported_at: string;
    todos: Array<{ title: string }>;
  };
  expect(ownerExport.todos.map((todo) => todo.title)).toEqual(['Owner-only task']);

  const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const otherPage = await otherContext.newPage();
  const otherCdp = await register(otherPage, `export-other-${Date.now()}`);
  const emptyExport = (await (
    await otherPage.request.get('/api/todos/export?format=json')
  ).json()) as { todos: unknown[] };
  expect(emptyExport.todos).toEqual([]);

  const imported = await otherPage.request.post('/api/todos/import', { data: ownerExport });
  expect(imported.status()).toBe(200);
  expect(await imported.json()).toMatchObject({ success: true, imported: 1 });
  const ownerTodos = (await (await page.request.get('/api/todos')).json()) as Array<{
    id: number;
    title: string;
  }>;
  const otherTodos = (await (await otherPage.request.get('/api/todos')).json()) as Array<{
    id: number;
    title: string;
  }>;
  expect(ownerTodos).toEqual([expect.objectContaining({ id: ownerTodo.id, title: 'Owner-only task' })]);
  expect(otherTodos).toHaveLength(1);
  expect(otherTodos[0].title).toBe('Owner-only task');
  expect(otherTodos[0].id).not.toBe(ownerTodo.id);

  await ownerCdp.detach();
  await otherCdp.detach();
  await otherContext.close();
});
