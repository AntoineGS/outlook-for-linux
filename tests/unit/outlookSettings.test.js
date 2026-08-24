'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const settingsSource = readFileSync(
  join(ROOT, 'app', 'browser', 'tools', 'settings.js'),
  'utf8',
);

describe('Outlook settings bridge', () => {
  it('round-trips empty Outlook settings without reading Outlook internals', () => {
    const handlers = new Map();
    const fakeIpc = {
      on(channel, handler) {
        handlers.set(channel, handler);
      },
    };
    const settings = require(join(ROOT, 'app', 'browser', 'tools', 'settings.js'));
    settings.init({}, fakeIpc);

    const getReplies = [];
    handlers.get('get-outlook-settings')({
      sender: { send: (...args) => getReplies.push(args) },
    });
    assert.deepEqual(getReplies, [['get-outlook-settings', {}]]);

    const setReplies = [];
    handlers.get('set-outlook-settings')(
      { sender: { send: (...args) => setReplies.push(args) } },
      { any: 'settings' },
    );
    assert.deepEqual(setReplies, [['set-outlook-settings', true]]);

    assert.doesNotMatch(settingsSource, /reactHandler/);
    assert.doesNotMatch(settingsSource, /Teams.*(?:preferences|settings)/i);
  });
});
