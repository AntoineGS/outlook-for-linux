'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const preloadSource = readFileSync(join(ROOT, 'app', 'browser', 'preload.js'), 'utf8');
const appSource = readFileSync(join(ROOT, 'app', 'index.js'), 'utf8');
const menuSource = readFileSync(join(ROOT, 'app', 'menus', 'appMenu.js'), 'utf8');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function declaredModules(source) {
  const match = source.match(/const\s+modules\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(match, 'preload modules array should remain a literal');
  return [...match[1].matchAll(/name:\s*["']([^"']+)["']/g)].map(([, name]) => name);
}

describe('Outlook runtime boundary', () => {
  it('initializes only generic Outlook preload modules', () => {
    const modules = declaredModules(preloadSource);
    for (const name of [
      'zoom',
      'shortcuts',
      'settings',
      'emulatePlatform',
      'webauthnOverride',
      'navigationButtons',
      'framelessTweaks',
    ]) {
      assert.ok(modules.includes(name), `expected generic module ${name}`);
    }

    for (const name of [
      'theme',
      'timestampCopyOverride',
      'mqttStatusMonitor',
      'meetingStartDetector',
      'overrideMicConstraints',
      'disableAutogain',
      'ignoreSystemMute',
      'speakingIndicator',
      'cameraResolution',
      'cameraAspectRatio',
      'customStickers',
      'dockIconRenderer',
      'preventDeviceSwitching',
    ]) {
      assert.ok(!modules.includes(name), `Teams-only module ${name} must not load`);
    }
  });

  it('does not start activity tracking or Teams-only main services', () => {
    assert.doesNotMatch(preloadSource, /new\s+ActivityManager\s*\(/);
    assert.match(appSource, /product\.features\.screenSharing/);
    assert.match(appSource, /product\.features\.customBackgrounds/);
    assert.match(appSource, /product\.features\.customStickers/);
  });

  it('keeps unread-count on the generic tray and badge APIs', () => {
    assert.match(preloadSource, /addEventListener\("unread-count"/);
    assert.match(preloadSource, /electronAPI\.updateTray\(/);
    assert.match(preloadSource, /electronAPI\.setBadgeCount\(/);
    assert.doesNotMatch(preloadSource, /trayIconRenderer/);
    assert.doesNotMatch(preloadSource, /mqttStatusMonitor/);
  });

  it('uses the packaged Outlook icon for notifications', () => {
    assert.match(preloadSource, /icon-96x96\.png/);
    assert.match(preloadSource, /options\.icon\s*=\s*options\.icon\s*\|\|\s*NOTIFICATION_ICON/);
    assert.doesNotMatch(preloadSource, /iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHe/);
  });

  it('uses the same audited Outlook 256px asset at runtime and in builds', () => {
    const runtimeIcon = join(ROOT, 'app', 'assets', 'icons', 'icon-256x256.png');
    const buildIcon = join(ROOT, 'build', 'icons', '256x256.png');
    assert.equal(sha256(readFileSync(runtimeIcon)), sha256(readFileSync(buildIcon)));
    assert.notEqual(
      sha256(readFileSync(runtimeIcon)),
      sha256(require('node:child_process').execFileSync('git', [
        'show', 'HEAD^:app/assets/icons/icon-256x256.png',
      ])),
    );
  });

  it('does not expose Teams-only menu entries', () => {
    for (const label of ['Join Meeting', 'Return to Teams', 'Quick Chat', 'Video']) {
      assert.doesNotMatch(menuSource, new RegExp(`label:\s*["']${label}["']`));
    }
  });
});
