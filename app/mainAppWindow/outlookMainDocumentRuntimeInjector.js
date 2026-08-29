'use strict';

const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const product = require('../product');

const CONFIG_TOKEN = '__OFL_CONFIG__';
const BUNDLE_FILE = join(
  __dirname,
  '..',
  'browser',
  'generated',
  'outlookBrowserRuntime.js',
);

/**
 * Inject the browser-only Outlook runtime into an approved main document.
 *
 * @param {Electron.WebFrameMain} frame The attached main frame to receive Vim.
 * @param {object} config Application configuration.
 * @param {{ loadBundle?: () => Promise<string>, readBundle?: () => Promise<string> }} [dependencies]
 * @returns {Promise<boolean>} Whether the runtime was executed successfully.
 */
async function injectOutlookMainDocumentRuntime(frame, config, dependencies = {}) {
  try {
    if (config?.shortcuts?.vim?.enabled !== true) {
      return false;
    }

    const isApprovedFrame = () => {
      if (!frame || typeof frame.isDestroyed !== 'function'
        || frame.isDestroyed() || frame.detached !== false || typeof frame.url !== 'string') {
        return false;
      }
      const currentUrl = new URL(frame.url);
      return currentUrl.protocol === 'https:' && !currentUrl.username
        && !currentUrl.password && currentUrl.port === ''
        && product.isAppHost(currentUrl.hostname);
    };

    if (!isApprovedFrame()) {
      return false;
    }

    const loadBundle = dependencies.loadBundle
      || dependencies.readBundle
      || (() => readFile(BUNDLE_FILE, 'utf8'));
    const bundleSource = await loadBundle();
    if (typeof bundleSource !== 'string'
      || bundleSource.split(CONFIG_TOKEN).length !== 2) {
      return false;
    }

    if (!isApprovedFrame()) return false;

    const runtimeConfig = { shortcuts: { vim: { enabled: true } } };
    const source = bundleSource.replace(CONFIG_TOKEN, JSON.stringify(runtimeConfig));
    await frame.executeJavaScript(source, false);
    return true;
  } catch {
    return false;
  }
}

module.exports = { injectOutlookMainDocumentRuntime };
