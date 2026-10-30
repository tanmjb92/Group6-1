import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page) {
  await page.goto('/login');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true,
    },
  });
  await page.getByLabel('Username').fill(`search-${Date.now()}`);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('No todos yet. Add one above to get started.')).toBeVisible();
  const tagResponse = await page.request.post('/api/tags', { data: { name: 'Work', color: '#000000' } });
  expect(tagResponse.ok()).toBe(true);
  const tag = await tagResponse.json();
  const dueYear = new Date().getUTCFullYear() + 1;
  for (const [title, priority, due, completed, tagged] of [
    ['Team meeting', 'high', `${dueYear}-11-01T16:30:00Z`, false, true],
    ['Shopping', 'medium', `${dueYear}-11-01T15:59:00Z`, false, false],
    ['Completed review', 'low', null, true, true],
    ['Other meeting', 'high', null, false, false],
  ] as const) {
    const response = await page.request.post('/api/todos', {
      data: { title, priority, due_date: due, tag_ids: tagged ? [tag.id] : [] },
    });
    expect(response.ok()).toBe(true);
    const todo = await response.json();
    if (completed) await page.request.put(`/api/todos/${todo.id}`, { data: { completed: true } });
    if (title === 'Shopping') await page.request.post(`/api/todos/${todo.id}/subtasks`, {
      data: { title: 'Buy CAFÉ supplies' },
    });
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pending (3)' })).toBeVisible();
  return { cdp, tag, dueYear };
}

test('searches titles/subtasks, combines all dimensions, and handles empty sections and dates', async ({ page }) => {
  const { cdp, tag, dueYear } = await setup(page);
  let filterRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/todos') filterRequests += 1;
  });
  const search = page.getByRole('searchbox', { name: 'Search todos and subtasks' });
  await search.fill(' MEETING ');
  await expect(page.getByRole('heading', { name: 'Pending (2)' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Completed', exact: true })).toHaveCount(0);
  await search.fill('café');
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Mark "Shopping" as complete' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pending (3)' })).toBeVisible();
  await search.fill('meeting');
  await page.getByLabel('Filter by priority', { exact: true }).selectOption('high');
  await page.getByLabel('Filter by tags', { exact: true }).selectOption(String(tag.id));
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByLabel('Completion Status').selectOption('incomplete');
  await page.getByLabel('Due Date From').fill(`${dueYear}-11-02`);
  await page.getByLabel('Due Date To').fill(`${dueYear}-11-02`);
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Mark "Team meeting" as complete' })).toBeVisible();
  await page.getByLabel('Due Date To').fill(`${dueYear}-11-01`);
  await expect(page.getByText('From date is after To date.')).toBeVisible();
  await expect(page.getByText('No todos match your filters.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pending', exact: true })).toHaveCount(0);
  expect(filterRequests).toBe(0);
  await page.getByRole('button', { name: 'Clear All', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByLabel('Completion Status')).toHaveValue('all');
  await expect(page.getByLabel('Due Date From')).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Pending (3)' })).toBeVisible();
  await page.getByLabel('Completion Status').selectOption('completed');
  await expect(page.getByRole('heading', { name: 'Completed (1)' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pending', exact: true })).toHaveCount(0);
  await cdp.detach();
});

test('debounces typing by 300ms, cancels stale searches, and clears immediately', async ({ page }) => {
  const { cdp } = await setup(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const search = page.getByRole('searchbox', { name: 'Search todos and subtasks' });
  await search.fill('Shop');
  await page.clock.runFor(200);
  await search.fill('MEETING');
  await page.clock.runFor(299);
  await expect(page.getByRole('heading', { name: 'Pending (3)' })).toBeVisible();
  await page.clock.runFor(1);
  await expect(page.getByRole('heading', { name: 'Pending (2)' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pending (3)' })).toBeVisible();
  await page.clock.runFor(300);
  await expect(page.getByRole('heading', { name: 'Pending (3)' })).toBeVisible();
  await cdp.detach();
});

test('persists, previews, applies, and deletes full-state presets and handles deleted tags', async ({ page }) => {
  const { cdp, tag, dueYear } = await setup(page);
  await page.getByRole('searchbox').fill('meeting');
  await page.getByLabel('Filter by priority', { exact: true }).selectOption('high');
  await page.getByLabel('Filter by tags', { exact: true }).selectOption(String(tag.id));
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByLabel('Completion Status').selectOption('incomplete');
  await page.getByLabel('Due Date From').fill(`${dueYear}-11-02`);
  await page.getByRole('button', { name: 'Save Filter', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('meeting');
  await expect(dialog).toContainText('Work');
  await expect(dialog).toContainText('Incomplete');
  await dialog.getByLabel('Filter name').fill('Morning work');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByLabel('Completion Status').selectOption('completed');
  await page.getByLabel('Due Date To').fill(`${dueYear}-11-01`);
  await page.getByRole('button', { name: 'Morning work', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('meeting');
  await expect(page.getByLabel('Completion Status')).toHaveValue('incomplete');
  await expect(page.getByLabel('Due Date To')).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  await page.getByRole('searchbox').fill('Shopping');
  await page.clock.runFor(299);
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  await page.clock.runFor(1);
  await expect(page.getByText('No todos match your filters.')).toBeVisible();
  await page.clock.resume();

  await page.request.delete(`/api/tags/${tag.id}`);
  await page.reload();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('button', { name: 'Morning work', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Filter notice' })).toContainText('no longer exists');
  await expect(page.getByRole('heading', { name: 'Pending (1)' })).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('button', { name: 'Delete preset Morning work' }).click();
  await expect(page.getByRole('button', { name: 'Morning work', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Morning work', exact: true })).toHaveCount(0);
  await cdp.detach();
});

test('surfaces corrupt and full storage without preventing filtering', async ({ page }) => {
  const { cdp } = await setup(page);
  await page.evaluate(() => localStorage.setItem('todo-app:filter-presets', '{'));
  await page.reload();
  await expect(page.getByRole('alert', { name: 'Saved filter error' })).toBeVisible();
  await page.getByRole('searchbox').fill('MEETING');
  await expect(page.getByRole('heading', { name: 'Pending (2)' })).toBeVisible();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
  });
  await page.getByRole('button', { name: 'Save Filter', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Filter name').fill('Cannot save');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('storage full');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await cdp.detach();
});
