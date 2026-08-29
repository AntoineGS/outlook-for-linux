'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { restoreSettingsFromFile } = require('../../app/menus/settings');

function fakeIpcMain() {
  const listeners = new Map();
  return {
    listeners,
    once(channel, handler) {
      listeners.set(channel, handler);
    },
  };
}

describe('settings file restore helper', () => {
  it('does not retain acknowledgement listeners for failed restores', () => {
    const directory = mkdtempSync(join(tmpdir(), 'outlook-settings-'));
    const settingsPath = join(directory, 'outlook_settings.json');
    const ipcMain = fakeIpcMain();
    const sent = [];
    const window = { webContents: { send: (...args) => sent.push(args) } };
    const warnings = [];
    const restore = (path) =>
      restoreSettingsFromFile({
        window,
        settingsPath: path,
        channel: 'set-outlook-settings',
        registerAcknowledgement: (handler) =>
          ipcMain.once('set-outlook-settings', handler),
        warn: (message) => warnings.push(message),
        onAcknowledged: () => {},
      });

    assert.equal(restore(join(directory, 'missing.json')), false);
    assert.equal(ipcMain.listeners.size, 0);

    writeFileSync(settingsPath, '{ malformed');
    assert.equal(restore(settingsPath), false);
    assert.equal(ipcMain.listeners.size, 0);

    writeFileSync(settingsPath, JSON.stringify({}));
    let acknowledgements = 0;
    assert.equal(
      restoreSettingsFromFile({
        window,
        settingsPath,
        channel: 'set-outlook-settings',
        registerAcknowledgement: (handler) =>
          ipcMain.once('set-outlook-settings', handler),
        warn: (message) => warnings.push(message),
        onAcknowledged: () => acknowledgements++,
      }),
      true,
    );
    assert.equal(ipcMain.listeners.size, 1);
    assert.deepEqual(sent, [['set-outlook-settings', {}]]);
    ipcMain.listeners.get('set-outlook-settings')({}, true);
    assert.equal(acknowledgements, 1);
    assert.equal(warnings.length, 2);
  });
});
