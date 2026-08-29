'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const { attach, isLoginUrl } = require('../../app/ssoPasswordPrefill/index');

// isLoginUrl is the gate that decides where the pre-fill injects a password,
// so its host- and scheme-matching is security-relevant and covered here.
describe('ssoPasswordPrefill.isLoginUrl', () => {
  it('matches the built-in Microsoft login hosts over HTTPS', () => {
    assert.strictEqual(isLoginUrl('https://login.microsoftonline.com/common/oauth2/authorize'), true);
    assert.strictEqual(isLoginUrl('https://login.microsoft.com/'), true);
    assert.strictEqual(isLoginUrl('https://login.live.com/'), true);
  });

  it('rejects unlisted login subdomains and lookalikes', () => {
    assert.strictEqual(isLoginUrl('https://eu.login.microsoftonline.com/'), false);
  });

  it('rejects http:// even on a recognised login host (no cleartext secrets)', () => {
    assert.strictEqual(isLoginUrl('http://login.microsoftonline.com/common'), false);
  });

  it('rejects non-http(s) schemes', () => {
    assert.strictEqual(isLoginUrl('file:///login.microsoftonline.com'), false);
    assert.strictEqual(isLoginUrl('ftp://login.microsoftonline.com/'), false);
  });

  it('rejects unrelated hosts', () => {
    assert.strictEqual(isLoginUrl('https://teams.microsoft.com/'), false);
    assert.strictEqual(isLoginUrl('https://example.com/'), false);
  });

  it('rejects look-alike hosts that only suffix a login domain', () => {
    assert.strictEqual(isLoginUrl('https://login.microsoftonline.com.evil.com/'), false);
    assert.strictEqual(isLoginUrl('https://notlogin.microsoftonline.com/'), false);
  });

  it('honours extraHosts, but still requires HTTPS', () => {
    assert.strictEqual(isLoginUrl('https://adfs.example.org/', ['example.org']), true);
    assert.strictEqual(isLoginUrl('https://example.org/', ['example.org']), true);
    assert.strictEqual(isLoginUrl('http://adfs.example.org/', ['example.org']), false);
    // Without the extra host configured, the federated host is not matched.
    assert.strictEqual(isLoginUrl('https://adfs.example.org/'), false);
  });

  it('accepts exact approved MCAS-normalized authentication hosts', () => {
    assert.strictEqual(isLoginUrl('https://login.microsoftonline.com.mcas.ms/'), true);
    assert.strictEqual(isLoginUrl('https://eu.login.microsoftonline.com.mcas.ms/'), false);
  });

  it('returns false for malformed or missing URLs', () => {
    assert.strictEqual(isLoginUrl('not a url'), false);
    assert.strictEqual(isLoginUrl(''), false);
    assert.strictEqual(isLoginUrl(undefined), false);
    assert.strictEqual(isLoginUrl(null), false);
  });
});

describe('ssoPasswordPrefill.attach', () => {
  it('uses native button activation to submit the Microsoft email step', async () => {
    let submitted = false;

    class FakeInput {
      constructor() {
        this.offsetParent = {};
        this.disabled = false;
        this.readOnly = false;
        this.value = '';
      }

      focus() {}
      dispatchEvent() {}
      getClientRects() { return [1]; }
    }

    const emailInput = new FakeInput();
    const nextButton = {
      offsetParent: {},
      disabled: false,
      readOnly: false,
      focus() {},
      getClientRects() { return [1]; },
      dispatchEvent() {},
      click() { submitted = true; },
    };
    const document = {
      documentElement: {},
      querySelector(selector) {
        if (selector === '#tilesHolder') return null;
        return null;
      },
      querySelectorAll(selector) {
        if (selector.includes('input[type=email]')) return [emailInput];
        if (selector.includes('#idSIButton9')) return [nextButton];
        return [];
      },
    };
    const window = { HTMLInputElement: FakeInput };
    window.window = window;

    const context = {
      window,
      document,
      Event: class Event {},
      MouseEvent: class MouseEvent {},
      MutationObserver: class MutationObserver {
        observe() {}
        disconnect() {}
      },
      setInterval: () => 1,
      clearInterval() {},
      setTimeout: () => 2,
      clearTimeout() {},
    };
    const frame = {
      url: 'https://login.microsoftonline.com/common/oauth2/authorize',
      executeJavaScript(script) {
        return vm.runInNewContext(script, context);
      },
    };
    const webContents = new EventEmitter();
    webContents.mainFrame = { framesInSubtree: [frame] };

    attach(
      { webContents },
      { auth: { webLogin: { user: 'person@example.com', autoSubmit: true } } },
    );
    webContents.emit('dom-ready');
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(emailInput.value, 'person@example.com');
    assert.strictEqual(submitted, true);
  });
});
