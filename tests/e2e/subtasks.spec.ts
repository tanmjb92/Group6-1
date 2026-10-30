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

async function createTodo(page: Page, title: string): Promise<number> {
  const response = await page.request.post('/api/todos', { data: { title } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: number }).id;
}

test('adds, completes, and removes subtasks while keeping parent completion independent', async ({
  page,
}) => {
  const cdp = await register(page, `subtasks-ui-${Date.now()}`);
  await page.getByLabel('Title').fill('Prepare report');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await page.getByRole('button', { name: 'Show subtasks for Prepare report' }).click();
  await page.getByLabel('Add a subtask to Prepare report').fill('Draft outline');
  await page.getByLabel('Add a subtask to Prepare report').press('Enter');
  await expect(page.getByText('0/1 subtasks')).toBeVisible();
  await expect(page.getByLabel('Add a subtask to Prepare report')).toHaveValue('');
  await expect(page.getByRole('progressbar', { name: 'Subtask completion for Prepare report' }))
    .toHaveAttribute('aria-valuenow', '0');

  const draftCheckbox = page.getByLabel('Mark subtask "Draft outline" as complete');
  await draftCheckbox.check();
  await expect(page.getByLabel('Mark subtask "Draft outline" as incomplete')).toBeEnabled();
  await expect(page.getByText('1/1 subtasks')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Subtask completion for Prepare report' }))
    .toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByRole('checkbox', { name: 'Mark "Prepare report" as complete' }))
    .not.toBeChecked();

  await page.getByLabel('Add a subtask to Prepare report').fill('Confirm source');
  await page.getByRole('button', { name: 'Add', exact: true }).last().click();
  await expect(page.getByText('1/2 subtasks')).toBeVisible();
  await expect(page.getByLabel('Add a subtask to Prepare report')).toHaveValue('');
  await page.getByRole('button', { name: 'Delete subtask Confirm source' }).click();
  await expect(page.getByText('1/1 subtasks')).toBeVisible();

  await page.getByRole('button', { name: 'Hide subtasks for Prepare report' }).click();
  await expect(page.getByText('1/1 subtasks')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Subtask completion for Prepare report' }))
    .toBeVisible();
  await cdp.detach();
});

test('requires authentication and rejects invalid subtask input', async ({ page }) => {
  expect(
    (await page.request.post('/api/todos/1/subtasks', { data: { title: 'No session' } })).status(),
  ).toBe(401);
  expect((await page.request.put('/api/subtasks/1', { data: { completed: true } })).status()).toBe(
    401,
  );
  expect((await page.request.delete('/api/subtasks/1')).status()).toBe(401);

  const cdp = await register(page, `subtasks-validation-${Date.now()}`);
  const todoId = await createTodo(page, 'Validate subtask input');
  expect(
    (
      await page.request.post(`/api/todos/${todoId}/subtasks`, {
        data: { title: '   ' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post(`/api/todos/${todoId}/subtasks`, {
        data: { title: 'Valid title' },
      })
    ).status(),
  ).toBe(201);
  const created = await page.request.post(`/api/todos/${todoId}/subtasks`, {
    data: { title: 'Another valid title' },
  });
  const subtaskId = ((await created.json()) as { id: number }).id;
  const tooLongTitle = 'x'.repeat(201);
  expect(
    (
      await page.request.post(`/api/todos/${todoId}/subtasks`, {
        data: { title: tooLongTitle },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.put(`/api/subtasks/${subtaskId}`, {
        data: { title: tooLongTitle },
      })
    ).status(),
  ).toBe(400);
  await cdp.detach();
});

test('preserves subtask changes when a parent update response is delayed', async ({ page }) => {
  const cdp = await register(page, `subtasks-race-${Date.now()}`);
  await page.getByLabel('Title').fill('Review launch plan');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Show subtasks for Review launch plan' }).click();
  await page.getByLabel('Add a subtask to Review launch plan').fill('Check schedule');
  await page.getByLabel('Add a subtask to Review launch plan').press('Enter');
  await expect(page.getByText('0/1 subtasks')).toBeVisible();
  await expect(page.getByLabel('Add a subtask to Review launch plan')).toHaveValue('');

  let releaseParentResponse!: () => void;
  let markParentRequestSeen!: () => void;
  const parentResponseGate = new Promise<void>((resolve) => {
    releaseParentResponse = resolve;
  });
  const parentRequestSeen = new Promise<void>((resolve) => {
    markParentRequestSeen = resolve;
  });
  await page.route(/\/api\/todos\/\d+$/, async (route) => {
    const response = await route.fetch();
    markParentRequestSeen();
    await parentResponseGate;
    await route.fulfill({ response });
  });

  const parentToggle = page
    .getByRole('checkbox', { name: 'Mark "Review launch plan" as complete' })
    .click();
  try {
    await parentRequestSeen;
    await page.getByRole('button', { name: 'Show subtasks for Review launch plan' }).click();
    await page.getByLabel('Add a subtask to Review launch plan').fill('Confirm owner');
    await page.getByLabel('Add a subtask to Review launch plan').press('Enter');
    await expect(page.getByText('0/2 subtasks')).toBeVisible();
    await expect(page.getByLabel('Add a subtask to Review launch plan')).toHaveValue('');
  } finally {
    releaseParentResponse();
    await parentToggle;
  }

  await expect(page.getByText('0/2 subtasks')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Mark "Review launch plan" as incomplete' }))
    .toBeChecked();
  await cdp.detach();
});

test('prevents overlapping parent updates while a save is pending', async ({ page }) => {
  const cdp = await register(page, `subtasks-parent-save-${Date.now()}`);
  await page.getByLabel('Title').fill('Finalize agenda');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route(/\/api\/todos\/\d+$/, async (route) => {
    const response = await route.fetch();
    await responseGate;
    await route.fulfill({ response });
  });

  const completionCheckbox = page.getByRole('checkbox', {
    name: 'Mark "Finalize agenda" as complete',
  });
  const completion = completionCheckbox.click();
  const completedCheckbox = page.getByRole('checkbox', {
    name: 'Mark "Finalize agenda" as incomplete',
  });
  try {
    await expect(completedCheckbox).toBeDisabled();
  } finally {
    releaseResponse();
    await completion;
  }
  await expect(completedCheckbox).toBeEnabled();
  await expect(completedCheckbox).toBeChecked();
  await cdp.detach();
});

test('ignores repeated edit submissions while the first save is pending', async ({ page }) => {
  const cdp = await register(page, `subtasks-edit-save-${Date.now()}`);
  await page.getByLabel('Title').fill('Review notes');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  const titleInput = dialog.getByLabel('Title');
  await titleInput.fill('Review final notes');

  let releaseResponse!: () => void;
  let markRequestSeen!: () => void;
  let updateRequests = 0;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const requestSeen = new Promise<void>((resolve) => {
    markRequestSeen = resolve;
  });
  await page.route(/\/api\/todos\/\d+$/, async (route) => {
    updateRequests += 1;
    const response = await route.fetch();
    markRequestSeen();
    await responseGate;
    await route.fulfill({ response });
  });

  const updateButton = dialog.getByRole('button', { name: 'Update' });
  const firstSave = updateButton.click();
  try {
    await requestSeen;
    await expect(dialog.getByRole('button').last()).toBeDisabled();
    await titleInput.press('Enter');
  } finally {
    releaseResponse();
    await firstSave;
  }

  expect(updateRequests).toBe(1);
  await expect(page.getByText('Review final notes')).toBeVisible();
  await cdp.detach();
});

test('prevents one user from creating, updating, or deleting another user subtasks', async ({
  browser,
  page,
}) => {
  const ownerCdp = await register(page, `subtasks-owner-${Date.now()}`);
  const todoId = await createTodo(page, 'Private parent');
  const created = await page.request.post(`/api/todos/${todoId}/subtasks`, {
    data: { title: 'Private child' },
  });
  expect(created.status()).toBe(201);
  const createdSubtask = (await created.json()) as { id: number; completed: boolean };
  const subtaskId = createdSubtask.id;

  const secondContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const secondPage = await secondContext.newPage();
  const secondCdp = await register(secondPage, `subtasks-other-${Date.now()}`);
  expect(
    (
      await secondPage.request.post(`/api/todos/${todoId}/subtasks`, {
        data: { title: 'Unauthorized child' },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await secondPage.request.put(`/api/subtasks/${subtaskId}`, {
        data: { completed: true },
      })
    ).status(),
  ).toBe(404);
  expect((await secondPage.request.delete(`/api/subtasks/${subtaskId}`)).status()).toBe(404);

  const ownerTodo = (await (await page.request.get(`/api/todos/${todoId}`)).json()) as {
    subtasks: Array<{ id: number; completed: boolean }>;
  };
  expect(ownerTodo.subtasks).toEqual([createdSubtask]);

  await ownerCdp.detach();
  await secondCdp.detach();
  await secondContext.close();
});