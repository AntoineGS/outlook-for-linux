const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { projectRendererConfig } = require('../../app/config/rendererConfig');

test('projects only configuration consumed by Outlook preload', () => {
  const secret = 'sentinel-renderer-secret';
  const source = {
    partition: 'persist:outlook-4-linux',
    frame: false,
    emulateWinChromiumPlatform: true,
    useMutationTitleLogic: true,
    notificationMethod: 'electron',
    disableNotifications: false,
    disableNotificationWindowFlash: true,
    disableBadgeCount: false,
    notifications: { timeoutType: 'never', extra: secret },
    auth: { webauthn: { enabled: true, pin: secret }, webLogin: { password: secret } },
    mqtt: { password: secret, brokerUrl: secret },
    customBackground: secret,
  };

  const projected = projectRendererConfig(source);

  assert.deepEqual(projected, {
    partition: 'persist:outlook-4-linux',
    frame: false,
    emulateWinChromiumPlatform: true,
    useMutationTitleLogic: true,
    notificationMethod: 'electron',
    disableNotifications: false,
    disableNotificationWindowFlash: true,
    disableBadgeCount: false,
    notifications: { timeoutType: 'never' },
    auth: { webauthn: { enabled: true } },
  });
  assert.doesNotMatch(JSON.stringify(projected), new RegExp(secret));
  assert.notEqual(projected.notifications, source.notifications);
  assert.notEqual(projected.auth, source.auth);
  assert.notEqual(projected.auth.webauthn, source.auth.webauthn);
  projected.auth.webauthn.enabled = false;
  assert.equal(source.auth.webauthn.enabled, true);
});

test('handles absent nested configuration without spreading source objects', () => {
  const projected = projectRendererConfig({});
  assert.deepEqual(projected.notifications, { timeoutType: undefined });
  assert.deepEqual(projected.auth, { webauthn: { enabled: false } });
});

test('does not log the raw configuration object', () => {
  const configSource = readFileSync(join(__dirname, '../../app/config/index.js'), 'utf8');
  assert.doesNotMatch(configSource, /console\.debug\("configFile:", configObject\.configFile\)/);
  assert.doesNotMatch(configSource, /JSON\.stringify\(configObject/);
});
