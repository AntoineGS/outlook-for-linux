'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  injectOutlookMainDocumentRuntime,
} = require('../../app/mainAppWindow/outlookMainDocumentRuntimeInjector');

const BUNDLE = 'runtime(); __OFL_CONFIG__;';
const CONFIG = {
  shortcuts: { vim: { enabled: true, extra: 'ignored' } },
  account: { email: 'private@example.test' },
};

function createFrame(url, { destroyed = false, detached = false, executeJavaScript } = {}) {
  return {
    isDestroyed: () => destroyed,
    url,
    detached,
    executeJavaScript: executeJavaScript || (async () => undefined),
  };
}

describe('injectOutlookMainDocumentRuntime', () => {
  it('executes the Vim-only bundle in an attached approved Outlook frame without a gesture', async () => {
    const executions = [];
    const frame = createFrame('https://outlook.office.com/mail/inbox', {
      executeJavaScript: async (source, userGesture) => executions.push({ source, userGesture }),
    });
    const result = await injectOutlookMainDocumentRuntime(frame, CONFIG, {
      loadBundle: async () => BUNDLE,
    });
    assert.equal(result, true);
    assert.deepEqual(executions, [{
      source: BUNDLE.replace('__OFL_CONFIG__', JSON.stringify({ shortcuts: { vim: { enabled: true } } })),
      userGesture: false,
    }]);
  });

  it('returns false before loading when Vim is disabled', async () => {
    let loads = 0;
    const result = await injectOutlookMainDocumentRuntime(
      createFrame('https://outlook.live.com/'),
      { shortcuts: { vim: { enabled: false } } },
      { loadBundle: async () => { loads++; return BUNDLE; } },
    );
    assert.equal(result, false);
    assert.equal(loads, 0);
  });

  it('rejects authentication, unrelated, insecure, malformed, and ported URLs before loading', async () => {
    const urls = [
      'not a URL', 'https://login.microsoftonline.com/common/oauth2',
      'http://outlook.office.com/', 'https://example.com/',
      'https://user:password@outlook.office.com/', 'https://outlook.office.com:444/',
    ];
    let loads = 0;
    for (const url of urls) {
      assert.equal(await injectOutlookMainDocumentRuntime(
        createFrame(url), CONFIG, { loadBundle: async () => { loads++; return BUNDLE; } },
      ), false, url);
    }
    assert.equal(loads, 0);
  });

  it('rejects destroyed, detached, and missing frames before loading', async () => {
    const frames = [
      createFrame('https://outlook.office.com/', { destroyed: true }),
      createFrame('https://outlook.office.com/', { detached: true }),
      null,
    ];
    let loads = 0;
    for (const frame of frames) {
      assert.equal(await injectOutlookMainDocumentRuntime(
        frame, CONFIG, { loadBundle: async () => { loads++; return BUNDLE; } },
      ), false);
    }
    assert.equal(loads, 0);
  });

  it('revalidates the frame URL after loading and before execution', async () => {
    let currentUrl = 'https://outlook.office.com/';
    let executed = false;
    const frame = {
      isDestroyed: () => false,
      detached: false,
      get url() { return currentUrl; },
      executeJavaScript: async () => { executed = true; },
    };
    const result = await injectOutlookMainDocumentRuntime(frame, CONFIG, {
      loadBundle: async () => { currentUrl = 'https://login.microsoftonline.com/'; return BUNDLE; },
    });
    assert.equal(result, false);
    assert.equal(executed, false);
  });

  it('revalidates the frame destruction state after loading', async () => {
    let destroyed = false;
    const destructionObservations = [];
    let executed = false;
    const frame = {
      isDestroyed: () => {
        destructionObservations.push(destroyed);
        return destroyed;
      },
      detached: false,
      url: 'https://outlook.office.com/',
      executeJavaScript: async () => { executed = true; },
    };
    const result = await injectOutlookMainDocumentRuntime(frame, CONFIG, {
      loadBundle: async () => { destroyed = true; return BUNDLE; },
    });
    assert.equal(result, false);
    assert.equal(executed, false);
    assert.deepEqual(destructionObservations, [false, true]);
  });

  it('revalidates the frame attachment state after loading', async () => {
    const frame = {
      isDestroyed: () => false,
      detached: false,
      url: 'https://outlook.office.com/',
      executeJavaScript: async () => { throw new Error('must not execute'); },
    };
    const result = await injectOutlookMainDocumentRuntime(frame, CONFIG, {
      loadBundle: async () => { frame.detached = true; return BUNDLE; },
    });
    assert.equal(result, false);
  });

  it('returns false when execution rejects or the token cardinality is invalid', async () => {
    assert.equal(await injectOutlookMainDocumentRuntime(createFrame('https://outlook.cloud.microsoft/', {
      executeJavaScript: async () => { throw new Error('execution failed'); },
    }), CONFIG, { loadBundle: async () => BUNDLE }), false);
    for (const bundle of ['runtime();', '__OFL_CONFIG__; __OFL_CONFIG__;']) {
      let executed = false;
      assert.equal(await injectOutlookMainDocumentRuntime(createFrame('https://outlook.office.com/', {
        executeJavaScript: async () => { executed = true; },
      }), CONFIG, { loadBundle: async () => bundle }), false);
      assert.equal(executed, false);
    }
  });
});
