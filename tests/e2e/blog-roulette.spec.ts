import { test, expect } from '@playwright/test';

// Smoke tests for Blog Roulette UI scaffolding.
// Real auth/DB tests require a seeded test user + Supabase test project.

test.describe('Blog Roulette — UI surface', () => {
  test('list page renders', async ({ page }) => {
    await page.goto('/blog-roulette');
    // Either redirected to login or shows the list shell
    const onLogin = await page
      .getByRole('heading', { name: /welcome back/i })
      .isVisible()
      .catch(() => false);
    if (onLogin) {
      test.skip();
      return;
    }
    await expect(
      page.getByRole('heading', { name: /your technical blogs/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /start new blog/i }),
    ).toBeVisible();
  });

  test('new-blog page shows title input + suggest button', async ({ page }) => {
    await page.goto('/blog-roulette/new');
    const onLogin = await page
      .getByRole('heading', { name: /welcome back/i })
      .isVisible()
      .catch(() => false);
    if (onLogin) {
      test.skip();
      return;
    }
    await expect(page.getByLabel(/blog title/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /suggest keywords/i }),
    ).toBeVisible();
  });
});
