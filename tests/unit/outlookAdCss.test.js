'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { AD_SUPPRESSION_CSS, STYLE_ID } = require('../../app/browser/tools/outlookAdSuppressor');
const { applyOutlookAdCss } = require('../../app/mainAppWindow/outlookAdCss');

function createFrame(url = 'https://outlook.live.com/mail/', executeJavaScript = async () => undefined) {
  return {
    url,
    detached: false,
    isDestroyed: () => false,
    executeJavaScript,
  };
}

describe('Outlook main-frame ad CSS', () => {
  it('executes one idempotent style script with the exported CSS', async () => {
    const calls = [];
    const frame = createFrame('https://outlook.live.com/mail/', async (...args) => calls.push(args));

    assert.equal(await applyOutlookAdCss(frame), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], false);
    assert.match(calls[0][0], new RegExp(STYLE_ID));
    assert.match(calls[0][0], /owaadbar/);
    assert.doesNotMatch(calls[0][0], /insertCSS/);

    const elements = new Map();
    const document = {
      head: { appendChild: (element) => elements.set(element.id, element) },
      createElement: () => ({ id: '', textContent: '' }),
      getElementById: (id) => elements.get(id) || null,
    };
    vm.runInNewContext(calls[0][0], { document });
    vm.runInNewContext(calls[0][0], { document });
    assert.equal(elements.size, 1);
    assert.equal(elements.get('ofl-ad-suppression').textContent, AD_SUPPRESSION_CSS);
  });

  it('rejects invalid, destroyed, detached, credentialed, and non-default-port frames', async () => {
    const cases = [
      null,
      {},
      createFrame('not a URL'),
      createFrame('https://outlook.example.com/mail/'),
      createFrame('https://login.microsoftonline.com/'),
      createFrame('http://outlook.live.com/mail/'),
      createFrame('https://user:password@outlook.live.com/mail/'),
      createFrame('https://outlook.live.com:8443/mail/'),
    ];
    const destroyed = createFrame();
    destroyed.isDestroyed = () => true;
    cases.push(destroyed);
    const detached = createFrame();
    detached.detached = true;
    cases.push(detached);

    for (const frame of cases) {
      let executionCount = 0;
      if (frame) frame.executeJavaScript = async () => { executionCount++; };
      assert.equal(await applyOutlookAdCss(frame), false);
      assert.equal(executionCount, 0);
    }
  });

  it('returns false instead of rejecting when frame access or execution throws', async () => {
    const throwingFrames = [
      { get isDestroyed() { throw new Error('destroyed access failed'); } },
      { detached: false, isDestroyed: () => false, get url() { throw new Error('URL access failed'); } },
      { detached: false, isDestroyed: () => false, url: 'https://outlook.live.com/', executeJavaScript: () => { throw new Error('execution failed'); } },
      { detached: false, isDestroyed: () => false, url: 'https://outlook.live.com/', executeJavaScript: async () => { throw new Error('async execution failed'); } },
    ];

    for (const frame of throwingFrames) {
      assert.equal(await applyOutlookAdCss(frame), false);
    }
  });

  it('keeps the stylesheet static and free of configuration or page data', () => {
    assert.equal(STYLE_ID, 'ofl-ad-suppression');
    assert.equal(require('../../app/browser/tools/outlookAdSuppressor').init, undefined);
    for (const marker of [
      'owaadbar',
      'ads-olk-icon.png',
      'adbarmetrochoice.svg',
      'fbAdLink',
      'data-app-section="MessageList"',
      '.ms-Shimmer-container',
    ]) {
      assert.match(AD_SUPPRESSION_CSS, new RegExp(marker.replace('.', String.raw`\.`)));
    }
    assert.match(AD_SUPPRESSION_CSS, /display:\s*none\s*!important/);
    assert.doesNotMatch(AD_SUPPRESSION_CSS, /aria-label|textContent|sponsored/i);
    assert.doesNotMatch(AD_SUPPRESSION_CSS, /microsoft.?365|buy.?microsoft/i);
    assert.match(AD_SUPPRESSION_CSS, /div:has\(> div > div > div\[id\^="owaadbar"\]\)/);
    assert.doesNotMatch(AD_SUPPRESSION_CSS, /(?:^|[;{])\s*(?:min-|max-)?(?:width|height)\s*:/im);
    assert.doesNotMatch(AD_SUPPRESSION_CSS, /clientWidth|clientHeight|offsetWidth|offsetHeight/);
    assert.doesNotMatch(AD_SUPPRESSION_CSS, /config|outlook\.live\.com|document|window|location/i);
  });
});
