import { expect, test } from '@playwright/test';

test.describe('Login page', () => {
  test('E2E-LOGIN-001 renders primary login options', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/');

    await expect(page.locator('#portal-title')).toContainText('Creole');
    await expect(page.locator('#signin-heading')).toHaveText('Welcome Back');
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#submit-button')).toHaveText(/send magic link/i);
    await expect(page.locator('#google-login-button')).toHaveText(/continue with google/i);

    const appleButton = page.locator('#apple-login-button');
    if (await appleButton.count()) {
      await expect(appleButton).toHaveText(/continue with apple/i);
    }

    expect(consoleErrors).toEqual([]);
  });

  test('E2E-LOGIN-002 keeps browser email validation on magic-link form', async ({ page }) => {
    await page.goto('/');

    const email = page.locator('#email');
    await email.fill('not-an-email');
    await page.locator('#submit-button').click();

    await expect(email).toBeFocused();
    await expect(page.locator('#signin-heading')).toBeVisible();
  });

  test('E2E-LOGIN-004 starts Google OAuth from the login card', async ({ page }) => {
    await page.goto('/');

    await page.locator('#google-login-button').click();
    await page.waitForLoadState('domcontentloaded');

    await expect(page).not.toHaveURL('about:blank');
    expect(page.url()).toMatch(/(accounts\.google\.com|supabase|localhost:3000)/);
  });

  test('E2E-LOGIN-005 starts Apple OAuth when the Apple button exists', async ({ page }) => {
    await page.goto('/');

    const appleButton = page.locator('#apple-login-button');
    test.skip((await appleButton.count()) === 0, 'Apple login button is not enabled in the current UI.');

    await appleButton.click();
    await page.waitForLoadState('domcontentloaded');

    await expect(page).not.toHaveURL('about:blank');
    expect(page.url()).toMatch(/(appleid\.apple\.com|supabase|localhost:3000)/);
  });

  test('E2E-LOGIN-006 supports keyboard navigation through visible controls', async ({ page }) => {
    await page.goto('/');

    const visibleControlIds = ['google-login-button', 'email', 'submit-button'];
    if (await page.locator('#apple-login-button').count()) {
      visibleControlIds.splice(1, 0, 'apple-login-button');
    }

    const focusedIds = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.id || '');
      if (id) focusedIds.add(id);
    }

    for (const id of visibleControlIds) {
      expect(focusedIds.has(id)).toBeTruthy();
    }
  });
});
