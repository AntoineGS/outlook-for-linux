'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const outlookAdSuppressor = require('../../app/browser/tools/outlookAdSuppressor');

function createFakeDocument() {
  const elements = new Map();
  const head = {
    children: [],
    appendChild(element) {
      this.children.push(element);
      elements.set(element.id, element);
      return element;
    },
  };

  return {
    head,
    createElement(tagName) {
      return { tagName, id: '', textContent: '' };
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
}

describe('Outlook ad suppressor', () => {
  it('injects one stylesheet with explicit Outlook ad markers', () => {
    const document = createFakeDocument();

    assert.equal(outlookAdSuppressor.init({}, document), true);
    assert.equal(outlookAdSuppressor.init({}, document), true);
    assert.equal(document.head.children.length, 1);

    const style = document.head.children[0];
    assert.equal(style.id, 'ofl-ad-suppression');
    assert.equal(style.tagName, 'style');

    for (const marker of [
      'owaadbar',
      'ads-olk-icon.png',
      'adbarmetrochoice.svg',
      'fbAdLink',
      'data-app-section="MessageList"',
      '.ms-Shimmer-container',
    ]) {
      assert.match(style.textContent, new RegExp(marker.replace('.', String.raw`\.`)));
    }
    assert.match(style.textContent, /display:\s*none\s*!important/);
    assert.match(style.textContent, /div:has\(> div\[id\^="owaadbar"\]\)/);
  });

  it('reclaims the exact residual flex slot around the direct Outlook ad marker', () => {
    assert.match(
      outlookAdSuppressor.AD_SUPPRESSION_CSS,
      /div:has\(> div > div > div\[id\^="owaadbar"\]\)/,
    );
  });

  it('does not use text, upsell, or size-only hiding rules', () => {
    const document = createFakeDocument();

    outlookAdSuppressor.init({}, document);
    const css = document.head.children[0].textContent;

    assert.doesNotMatch(css, /aria-label|textContent|sponsored/i);
    assert.doesNotMatch(css, /microsoft.?365|buy.?microsoft/i);
    assert.doesNotMatch(css, /(?:^|[;{])\s*(?:min-|max-)?(?:width|height)\s*:/im);
    assert.doesNotMatch(css, /clientWidth|clientHeight|offsetWidth|offsetHeight/);
  });

  it('fails closed when a document head is unavailable', () => {
    assert.equal(outlookAdSuppressor.init({}, null), false);
    assert.equal(outlookAdSuppressor.init({}, {}), false);
    assert.equal(outlookAdSuppressor.init({}, {
      head: {},
      createElement() {
        return {};
      },
      getElementById() {
        return null;
      },
    }), false);
  });
});
