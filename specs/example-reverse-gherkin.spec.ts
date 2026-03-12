import { test, expect } from '@playwright/test';

test.describe('Playwright Homepage', () => {
  test('As a visitor to the homepage I can see the correct title in my browser', async ({
    page,
  }) => {
    await test.step('Given I visit the Playwright homepage', async () => {
      await page.goto('https://playwright.dev/');
    });

    await test.step('Then I should see the title of end page ends with "Playwright"', async () => {
      await expect(page).toHaveTitle(/Playwright$/);
    });
  });

  test.skip('As a visitor to the homepage I can navigate to the get started page to see installation instructions', async ({
    page,
  }) => {
    await test.step('Given I visit the Playwright homepage', async () => {
      await page.goto('https://playwright.dev/');
    });

    await test.step('When I click the get started link', async () => {
      await page.getByRole('link', { name: 'Get started' }).click();
    });

    await test.step('Then I should see the "Installation" heading', async () => {
      await expect(
        page.getByRole('heading', { name: 'Installation', exact: true })
      ).toBeVisible();
    });
  });
});
