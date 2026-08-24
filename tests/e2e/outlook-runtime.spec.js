import { test, expect } from '@playwright/test';
import {
  startApp,
  findMainOutlookWindow,
  waitForLoginRedirect,
  closeAndCleanup,
} from './helpers/electronApp.js';

test('Outlook has no Teams-only IPC handlers or renderer APIs', async () => {
  const ctx = await startApp({ prefix: 'outlook-e2e-runtime-', allowEval: true });

  try {
    const mainWindow = findMainOutlookWindow(ctx.electronApp);
    await waitForLoginRedirect(mainWindow);

    const channels = await ctx.electronApp.evaluate(({ ipcMain }) => {
      const events = ipcMain.eventNames();
      const handlers = ipcMain._invokeHandlers || {};
      return {
        listeners: Object.fromEntries(events.map((channel) => [channel, ipcMain.listenerCount(channel)])),
        handlers: handlers instanceof Map ? [...handlers.keys()] : Object.keys(handlers),
      };
    });

    for (const channel of [
      'get-custom-bg-list',
      'get-sticker-list',
      'import-sticker-url',
      'delete-sticker',
      'graph-api-get-user-profile',
      'graph-api-get-calendar-events',
      'graph-api-get-calendar-view',
      'graph-api-create-calendar-event',
      'graph-api-get-mail-messages',
      'graph-api-search-people',
      'graph-api-send-chat-message',
      'quick-chat:show',
      'quick-chat:hide',
      'join-meeting-submit',
      'join-meeting-cancel',
      'incoming-call-action',
      'incoming-call-toast-ready',
      'screen-sharing-started',
      'screen-sharing-stopped',
      'screen-share-port',
      'desktop-capturer-get-sources',
      'get-screen-sharing-displays',
      'choose-desktop-media',
      'cancel-desktop-media',
      'get-screen-sharing-status',
      'get-screen-share-stream',
      'get-screen-share-screen',
      'resize-preview-window',
      'stop-screen-sharing-from-thumbnail',
      'select-source',
      'selected-source',
      'source-selected',
      'close-view',
      'call-connected',
      'call-disconnected',
      'incoming-call-created',
      'incoming-call-ended',
      'user-status-changed',
      'camera-state-changed',
      'microphone-state-changed',
      'meeting-started',
    ]) {
      expect(channels.listeners[channel] || 0, `${channel} listener count`).toBe(0);
      expect(channels.handlers, `${channel} handler`).not.toContain(channel);
    }

    await expect(mainWindow.evaluate(() => ({
      desktopCapture: globalThis.electronAPI?.desktopCapture,
      openChatWithUser: globalThis.electronAPI?.openChatWithUser,
      graphApi: globalThis.electronAPI?.graphApi,
    }))).resolves.toEqual({
      desktopCapture: undefined,
      openChatWithUser: undefined,
      graphApi: undefined,
    });
  } finally {
    await closeAndCleanup(ctx);
  }
});

test('unread-count updates the Outlook tray and badge through generic APIs', async () => {
  const ctx = await startApp({ prefix: 'outlook-e2e-runtime-unread-', allowEval: true });

  try {
    const mainWindow = findMainOutlookWindow(ctx.electronApp);
    await waitForLoginRedirect(mainWindow);

    await ctx.electronApp.evaluate(({ ipcMain }) => {
      globalThis.__capturedUnread = { tray: [], badge: [] };
      ipcMain.on('tray-update', (_event, payload) => globalThis.__capturedUnread.tray.push(payload));
      const handlers = ipcMain._invokeHandlers;
      const original = handlers instanceof Map
        ? handlers.get('set-badge-count')
        : handlers['set-badge-count'];
      const wrapped = async (event, count) => {
        globalThis.__capturedUnread.badge.push(count);
        return original(event, count);
      };
      if (handlers instanceof Map) {
        handlers.set('set-badge-count', wrapped);
      } else {
        handlers['set-badge-count'] = wrapped;
      }
    });

    await mainWindow.evaluate(() => {
      globalThis.dispatchEvent(new CustomEvent('unread-count', { detail: { number: 3 } }));
    });

    await expect.poll(async () => ctx.electronApp.evaluate(() => globalThis.__capturedUnread), {
      timeout: 15000,
    }).toEqual({
      tray: [{ icon: null, flash: true, count: 3 }],
      badge: [3],
    });
  } finally {
    await closeAndCleanup(ctx);
  }
});
