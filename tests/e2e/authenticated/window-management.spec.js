const { test, expect } = require('@playwright/test');
const product = require('../../../app/product.js');
const { launchAuthenticatedApp, waitForOutlookWindow, closeApp } = require('./helpers.js');

test.describe('Window management', () => {
  let electronApp;

  test.afterEach(async () => {
    await closeApp(electronApp);
  });

  // eslint-disable-next-line no-empty-pattern
  test('main window has a reasonable size', async ({}, testInfo) => {
    const sessionDir = testInfo.project.use.sessionDir;
    electronApp = await launchAuthenticatedApp(sessionDir);

    const mainWindow = await waitForOutlookWindow(electronApp);
    expect(mainWindow).toBeTruthy();

    // Use JavaScript to get the actual window dimensions since
    // Playwright's viewportSize() returns null for Electron windows
    const dimensions = await mainWindow.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    }));

    expect(dimensions.innerWidth).toBeGreaterThan(400);
    expect(dimensions.innerHeight).toBeGreaterThan(300);
  });

  // eslint-disable-next-line no-empty-pattern
  test('app is responsive and has no crash indicators', async ({}, testInfo) => {
    const sessionDir = testInfo.project.use.sessionDir;
    electronApp = await launchAuthenticatedApp(sessionDir);

    const mainWindow = await waitForOutlookWindow(electronApp);
    expect(mainWindow).toBeTruthy();

    // Outlook maintains constant WebSocket activity so networkidle never
    // triggers. Use domcontentloaded instead.
    await mainWindow.waitForLoadState('domcontentloaded', { timeout: 60000 });

    const url = mainWindow.url();
    const hostname = new URL(url).hostname;
    expect(product.authHosts).not.toContain(hostname);
    expect(product.appHosts).toContain(hostname);

    const crashCount = await mainWindow.locator('text=/something went wrong/i').count();
    expect(crashCount).toBe(0);
  });
});
