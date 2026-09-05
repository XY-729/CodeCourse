import { test, expect } from '@playwright/test';

test('review gallery loads all samples and playable video', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/review.html');
  await page.evaluate(() => document.fonts.ready);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
  await page.locator('[data-scene="ask"] a').first().click();
  await expect(page.locator('#ask')).toHaveAttribute('src', /ask-1280x720\.png/);
  await page.locator('[data-scene="ask"] a').nth(1).click();
  await expect.poll(() => page.locator('video').evaluate(el => el.readyState)).toBeGreaterThanOrEqual(1);
  expect(await page.locator('video').evaluate(el => el.duration)).toBeGreaterThan(8);
  await page.screenshot({ path: 'artifacts/review-gallery.png' });
  expect(errors).toEqual([]);
});
