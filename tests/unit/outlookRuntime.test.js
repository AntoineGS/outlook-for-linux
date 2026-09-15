'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const preloadSource = readFileSync(join(ROOT, 'app', 'browser', 'preload.js'), 'utf8');
const appSource = readFileSync(join(ROOT, 'app', 'index.js'), 'utf8');
const mainWindowSource = readFileSync(join(ROOT, 'app', 'mainAppWindow', 'index.js'), 'utf8');
const menuSource = readFileSync(join(ROOT, 'app', 'menus', 'appMenu.js'), 'utf8');
const menusSource = readFileSync(join(ROOT, 'app', 'menus', 'index.js'), 'utf8');

const addEventHandlersMatch = mainWindowSource.match(
  /function addEventHandlers\(\) \{([\s\S]*?)\n\}\n\nfunction getWebRequestFilterFromURL/,
);
const rootFinishLoadBody = mainWindowSource.match(
  /function onDidFinishLoad\(\) \{([\s\S]*?)\n\}\n\nfunction injectScreenSharingLogic/,
);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function declaredModules(source) {
  const match = source.match(/const\s+modules\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(match, 'preload modules array should remain a literal');
  return [...match[1].matchAll(/name:\s*["']([^"']+)["']/g)].map(([, name]) => name);
}

function createRootFinishLoadHandler() {
  const match = mainWindowSource.match(
    /function onDidFinishLoad\(\) \{([\s\S]*?)\n\}\n\nfunction injectScreenSharingLogic/,
  );
  assert.ok(match, 'root did-finish-load handler should remain a named function');
  return new Function(
    'window',
    'config',
    'product',
    'applyOutlookAdCss',
    'injectOutlookMainDocumentRuntime',
    'customCSS',
    'initSystemThemeFollow',
    match[1],
  );
}

function createRootFrameFinishLoadHandler() {
  const match = mainWindowSource.match(
    /function onDidFrameFinishLoad\(\s*event,\s*isMainFrame,\s*frameProcessId,\s*frameRoutingId\s*\) \{([\s\S]*?)\n\}/,
  );
  assert.ok(match, 'root did-frame-finish-load handler should remain a named function');
  return new Function(
    'event', 'isMainFrame', 'frameProcessId', 'frameRoutingId',
    'webFrameMain', 'customCSS', 'applyOutlookAdCss', 'injectOutlookMainDocumentRuntime', 'config', match[1],
  );
}

describe('Outlook runtime boundary', () => {
  it('initializes only generic Outlook preload modules', () => {
    const modules = declaredModules(preloadSource);
    for (const name of [
      'zoom',
      'shortcuts',
      'emulatePlatform',
       'webauthnOverride',
       'framelessTweaks',
    ]) {
      assert.ok(modules.includes(name), `expected generic module ${name}`);
    }

    for (const name of [
      'navigationButtons',
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
      'settings',
    ]) {
      assert.ok(!modules.includes(name), `Teams-only module ${name} must not load`);
    }
  });

  it('does not expose Vim spike bridges or testing globals from preload', () => {
    assert.doesNotMatch(preloadSource, /E2E_TESTING/);
    assert.doesNotMatch(preloadSource, /__vimRichText/);
    assert.doesNotMatch(preloadSource, /vimRichTextSpikeBridge/);
  });

  it('exposes only the fixed-ID Outlook replay API', () => {
    assert.match(preloadSource, /replayOutlookShortcut:\s*\(shortcutId\)\s*=>/);
    assert.match(preloadSource, /ipcRenderer\.invoke\(['"]vim-replay-outlook-shortcut['"], shortcutId\)/);
    assert.match(preloadSource, /typeof shortcutId !== ['"]string['"] \|\| shortcutId\.length > 40/);
    assert.doesNotMatch(preloadSource, /sendInputEvent/);
    assert.doesNotMatch(preloadSource, /arbitraryAccelerator|accelerator.*config/i);
  });

  it('keeps get-config internal to preload without exposing a config bridge', () => {
    assert.doesNotMatch(preloadSource, /getConfig:\s*\(\)\s*=>/);
    assert.match(preloadSource, /ipcRenderer\.invoke\(["']get-config["']\)/);
  });

  it('does not own Vim or ad suppression in preload', () => {
    assert.doesNotMatch(preloadSource, /vimBindings/);
    assert.doesNotMatch(preloadSource, /outlookAdSuppressor/);
  });

  it('does not let did-finish-load own native ad CSS or Vim injection', () => {
    let adCssApplications = 0;
    const handler = createRootFinishLoadHandler();
    const window = {
      webContents: {
        getURL: () => 'https://outlook.live.com/mail/',
        executeJavaScript: async () => undefined,
      },
    };
    const product = { features: { screenSharing: false } };
    const customCSS = {
      onDidFinishLoad: () => {},
    };

    handler(
      window,
      {},
      product,
      undefined,
      undefined,
      customCSS,
      () => {},
    );
    handler(
      window,
      {},
      product,
      undefined,
      undefined,
      customCSS,
      () => {},
    );

    assert.equal(adCssApplications, 0);
  });

  it('registers the root did-finish-load handler with addEventHandlers', () => {
    assert.ok(addEventHandlersMatch, 'addEventHandlers should remain a named function');
    assert.match(addEventHandlersMatch[1], /window\.webContents\.on\("did-finish-load", onDidFinishLoad\)/);
    assert.match(addEventHandlersMatch[1], /window\.webContents\.on\("did-frame-finish-load", onDidFrameFinishLoad\)/);
  });

  it('does not let did-finish-load own Vim runtime injection', () => {
    assert.ok(rootFinishLoadBody, 'root did-finish-load body should be available');
    assert.doesNotMatch(rootFinishLoadBody[1], /injectOutlookMainDocumentRuntime/);
    assert.doesNotMatch(mainWindowSource, /function onDidNavigateInPage\s*\(/);
  });

  it('does not apply native CSS on a non-HTTPS root load', () => {
    let adCssApplications = 0;
    const handler = createRootFinishLoadHandler();
    const window = {
      webContents: {
        getURL: () => 'chrome-error://chromewebdata/',
        executeJavaScript: async () => undefined,
      },
    };

    handler(window, {}, { features: { screenSharing: false } }, undefined, undefined,
      { onDidFinishLoad: () => {} }, () => {});

    assert.equal(adCssApplications, 0);
  });

  it('injects only the main frame resolved with the exact Electron frame arguments', () => {
    let adCssApplications = 0;
    let vimApplications = 0;
    const frame = { url: 'https://outlook.office.com/' };
    const calls = [];
    const webFrameMain = { fromId: (...args) => { calls.push(args); return frame; } };
    const customCSS = { onDidFrameFinishLoad: () => { throw new Error('must not run for main frame'); } };
    let adFrame;
    let vimFrame;
    const adCss = async (receivedFrame) => { adFrame = receivedFrame; adCssApplications++; };
    const injector = async (receivedFrame) => { vimFrame = receivedFrame; vimApplications++; };
    const handler = createRootFrameFinishLoadHandler();

    handler({ type: 'event' }, true, 12, 34, webFrameMain, customCSS, adCss, injector, {});

    assert.deepEqual(calls, [[12, 34]]);
    assert.equal(adCssApplications, 1);
    assert.equal(vimApplications, 1);
    assert.equal(adFrame, frame);
    assert.equal(vimFrame, frame);
  });

  it('does not apply ad CSS or Vim to non-main frames', () => {
    let adCssApplications = 0;
    let vimApplications = 0;
    let customCssApplications = 0;
    const handler = createRootFrameFinishLoadHandler();
    const webFrameMain = { fromId: () => ({}) };

    handler({}, false, 12, 34, webFrameMain, {
      onDidFrameFinishLoad: () => { customCssApplications++; },
    }, async () => { adCssApplications++; }, async () => { vimApplications++; }, {});

    assert.equal(adCssApplications, 0);
    assert.equal(vimApplications, 0);
    assert.equal(customCssApplications, 1);
  });

  it('contains ad and Vim rejections independently without blocking the other', async () => {
    const handler = createRootFrameFinishLoadHandler();
    const webFrameMain = { fromId: () => ({}) };
    let adCssApplications = 0;
    let vimApplications = 0;
    const unhandled = [];
    const onUnhandledRejection = (reason) => unhandled.push(reason);
    process.once('unhandledRejection', onUnhandledRejection);

    handler({}, true, 12, 34, webFrameMain, {}, async () => {
      throw new Error('ad CSS failed');
    }, async () => {
      vimApplications++;
    }, {});
    handler({}, true, 12, 34, webFrameMain, {}, async () => {
      adCssApplications++;
    }, async () => {
      throw new Error('injection failed');
    }, {});
    await Promise.resolve();
    await Promise.resolve();

    process.removeListener('unhandledRejection', onUnhandledRejection);
    assert.deepEqual(unhandled, []);
    assert.equal(adCssApplications, 1);
    assert.equal(vimApplications, 1);
  });

  it('does not start activity tracking or Teams-only main services', () => {
    assert.doesNotMatch(preloadSource, /new\s+ActivityManager\s*\(/);
    assert.match(appSource, /product\.features\.screenSharing/);
    assert.match(appSource, /product\.features\.customBackgrounds/);
    assert.match(appSource, /product\.features\.customStickers/);
  });

  it('does not eagerly import disabled Teams services during startup', () => {
    const networkErrorEnd = appSource.indexOf('function isNetworkError');
    assert.ok(networkErrorEnd > 0);
    const braceRange = (openAt) => {
      let depth = 0;
      for (let index = openAt; index < appSource.length; index += 1) {
        if (appSource[index] === '{') depth += 1;
        if (appSource[index] === '}' && --depth === 0) return [openAt, index];
      }
      assert.fail(`unclosed block at ${openAt}`);
    };
    const functionBody = (name, startAt = networkErrorEnd) => {
      const start = appSource.indexOf(`function ${name}`, startAt);
      assert.ok(start > networkErrorEnd, `${name} should remain below isNetworkError`);
      return braceRange(appSource.indexOf('{', start));
    };
    const allowedRequires = [
      ['initializeMqtt', './mqtt'],
      ['initializeMqtt', './mqtt/mediaStatusService'],
      ['initializeMqtt', './mqtt/homeAssistantDiscovery'],
      ['initializeGraphApiClient', './graphApi'],
      ['initializeQuickChat', './quickChat'],
      ['handleAppReady', './customBackground'],
      ['handleAppReady', './customStickers'],
      ['handleAppReady', './graphApi/ipcHandlers'],
      ['screenSharing', './screenSharing/service'],
    ];
    const screenSharingConditionalStart = appSource.indexOf(
      'const screenSharingService = product.features.screenSharing',
    );
    const screenSharingConditionalEnd = appSource.indexOf(';', screenSharingConditionalStart);
    assert.ok(screenSharingConditionalStart > networkErrorEnd);
    assert.ok(screenSharingConditionalEnd > screenSharingConditionalStart);
    const allowedRanges = new Map([
      ...allowedRequires.slice(0, -1).map(([functionName, moduleName]) => [
        moduleName,
        functionBody(functionName),
      ]),
      ['./screenSharing/service', [screenSharingConditionalStart, screenSharingConditionalEnd]],
    ]);
    for (const [functionName, moduleName] of allowedRequires) {
      const occurrences = [];
      const escapedModuleName = moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const requirePattern = new RegExp(`require\\(\\s*["']${escapedModuleName}["']\\s*\\)`, 'g');
      for (const match of appSource.matchAll(requirePattern)) occurrences.push(match.index);
      assert.equal(occurrences.length, 1, `${moduleName} must have exactly one require`);
      const [bodyStart, bodyEnd] = allowedRanges.get(moduleName);
      assert.ok(occurrences[0] > bodyStart && occurrences[0] < bodyEnd, `${moduleName} must be inside ${functionName}`);
    }

    const menuImports = menusSource.slice(0, menusSource.indexOf('class Menus'));
    assert.doesNotMatch(menuImports, /joinMeetingDialog/);
    assert.doesNotMatch(menuImports, /require\(["']\.\/settings["']\)/);
  });

  it('does not register a session-wide frame preload', () => {
    assert.equal(
      existsSync(join(ROOT, 'app', 'mainAppWindow', 'browserPreloadSession.js')),
      false,
    );
    assert.equal(
      existsSync(join(ROOT, 'app', 'browser', 'sessionPreload.js')),
      false,
    );
  });

  it('keeps the browser runtime build pipeline owned by Tasks 1–2', () => {
    for (const relativePath of [
      'app/browser/outlookBrowserRuntime.js',
      'scripts/buildOutlookBrowserRuntime.js',
      'tests/unit/buildOutlookBrowserRuntime.test.js',
      'tests/unit/outlookMainDocumentRuntimeInjector.test.js',
    ]) {
      assert.equal(existsSync(join(ROOT, relativePath)), true, `${relativePath} must exist`);
    }

    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(packageJson.devDependencies.esbuild, '0.28.2');
    assert.equal(packageJson.scripts['build:outlook-runtime'], 'node scripts/buildOutlookBrowserRuntime.js');
    assert.match(packageJson.scripts['prestart:dev'], /build:outlook-runtime/);
    assert.match(packageJson.scripts['pretest:e2e'], /build:outlook-runtime/);
    assert.match(packageJson.scripts['pretest:authenticated'], /build:outlook-runtime/);
    assert.equal(packageJson.scripts.prepack, undefined);
    assert.equal(packageJson.build.beforePack, 'scripts/buildOutlookBrowserRuntime.js');
    assert.match(readFileSync(join(ROOT, '.gitignore'), 'utf8'), /^\/app\/browser\/generated\/$/m);
  });

  it('keeps IPC documentation discovery narrow and avoids global channel dedupe', () => {
	    const generator = readFileSync(join(ROOT, 'scripts', 'generateIpcDocs.js'), 'utf8');
    assert.ok(generator.includes(String.raw`ipcMain\.(handle|on|once)`));
    assert.doesNotMatch(generator, /registerFeatureIpc\(/);
    assert.doesNotMatch(generator, /findIndex\(candidate => candidate\.name === channel\.name\)/);
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
    const auditedOutlook256Hash =
      '7630c5b7190ae63cb2a7d8d4abab6011684b4a982f31a209610a694148233b58';
    assert.equal(sha256(readFileSync(runtimeIcon)), auditedOutlook256Hash);
    assert.equal(sha256(readFileSync(buildIcon)), auditedOutlook256Hash);
  });

  it('does not expose Teams-only menu entries', () => {
    for (const label of ['Join Meeting', 'Return to Teams', 'Quick Chat', 'Video']) {
      assert.doesNotMatch(menuSource, new RegExp(`label:\s*["']${label}["']`));
    }
  });

  it('keeps config migration available while hiding Teams settings backup', () => {
    const buildAppMenu = require('../../app/menus/appMenu');
    const menu = buildAppMenu({
      configGroup: {
        startupConfig: {
          appIcon: '',
          multiAccount: { enabled: false },
        },
      },
    });
    const settings = menu.submenu.find((item) => item.label === 'Settings');

    assert.ok(settings);
    assert.deepEqual(
      settings.submenu.filter((item) => item.label).map((item) => item.label),
      ['Show Updated Config…'],
    );
  });
});
