const { test, expect } = require('@playwright/test');
const product = require('../../../app/product.js');
const { launchAuthenticatedApp, waitForOutlookWindow, closeApp } = require('./helpers.js');

test.describe('Authenticated app launch', () => {
  let electronApp;

  test.afterEach(async () => {
    await closeApp(electronApp);
  });

  // eslint-disable-next-line no-empty-pattern
  test('app loads Outlook without redirecting to login', async ({}, testInfo) => {
    const sessionDir = testInfo.project.use.sessionDir;
    electronApp = await launchAuthenticatedApp(sessionDir);

    const mainWindow = await waitForOutlookWindow(electronApp);
    expect(mainWindow, 'Main Outlook window should exist').toBeTruthy();

    const url = mainWindow.url();
    const hostname = new URL(url).hostname;

    // Should be on an Outlook domain, NOT on a Microsoft login page.
    expect(product.authHosts).not.toContain(hostname);
    expect(product.appHosts).toContain(hostname);
  });

  // eslint-disable-next-line no-empty-pattern
  test('Outlook UI loads to a usable state', async ({}, testInfo) => {
    const sessionDir = testInfo.project.use.sessionDir;
    electronApp = await launchAuthenticatedApp(sessionDir);

    const mainWindow = await waitForOutlookWindow(electronApp);
    expect(mainWindow).toBeTruthy();

    // Outlook maintains constant WebSocket activity so networkidle never
    // triggers. Use domcontentloaded instead.
    await mainWindow.waitForLoadState('domcontentloaded', { timeout: 60000 });

    // Verify no crash errors in the page
    const crashIndicators = await mainWindow.locator('text=/something went wrong/i').count();
    expect(crashIndicators, 'No crash indicators should be visible').toBe(0);
  });
});
