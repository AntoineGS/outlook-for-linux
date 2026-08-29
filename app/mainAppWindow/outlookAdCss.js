'use strict';

const product = require('../product');
const { AD_SUPPRESSION_CSS, STYLE_ID } = require('../browser/tools/outlookAdSuppressor');

/**
 * Apply Outlook's ad suppression stylesheet to an attached main frame.
 *
 * @param {Electron.WebFrameMain} frame target top-level Outlook frame
 * @returns {Promise<boolean>} whether the stylesheet was inserted
 */
async function applyOutlookAdCss(frame) {
  try {
    const isApprovedFrame = () => {
      if (!frame || typeof frame.isDestroyed !== 'function'
        || frame.isDestroyed() || frame.detached !== false || typeof frame.url !== 'string') {
        return false;
      }

      const url = new URL(frame.url);
      return url.protocol === 'https:' && !url.username && !url.password
        && url.port === '' && product.isAppHost(url.hostname);
    };

    if (!isApprovedFrame() || typeof frame.executeJavaScript !== 'function') {
      return false;
    }

    if (!isApprovedFrame()) {
      return false;
    }

    const source = `(() => {
      const styleId = ${JSON.stringify(STYLE_ID)};
      if (!document.head || document.getElementById(styleId)) return;
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = ${JSON.stringify(AD_SUPPRESSION_CSS)};
      document.head.appendChild(style);
    })();`;
    await frame.executeJavaScript(source, false);
    return true;
  } catch {
    return false;
  }
}

module.exports = { applyOutlookAdCss };
