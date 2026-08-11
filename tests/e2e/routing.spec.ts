import { expect, test } from '@playwright/test';

test.describe('Protected routes', () => {
  test('E2E-DASH-001 redirects signed-out users away from dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#signin-heading')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('E2E-ADMIN-001 redirects signed-out users away from admin dashboard', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#signin-heading')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });
});
