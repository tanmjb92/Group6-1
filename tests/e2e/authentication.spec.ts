import { expect, test } from '@playwright/test';

test('registers, logs in, adds a second passkey, and logs in from it', async ({ page }) => {
  await page.goto('/login');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const firstDevice = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  const username = `e2e-${Date.now()}`;

  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL('/login');

  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Username already taken');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL('/');

  await page.reload();
  await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL('/');

  await cdp.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: firstDevice.authenticatorId,
  });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  await page.getByRole('button', { name: 'Add another passkey' }).click();
  await expect(page.getByRole('status')).toHaveText('Passkey added.');

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();
  await cdp.detach();
});

test('redirects unauthenticated visits to protected routes and rejects /api/auth/me', async ({
  page,
}) => {
  await page.goto('/calendar');
  await expect(page).toHaveURL('/login');

  const response = await page.request.get('/api/auth/me');
  expect(response.status()).toBe(401);
});
