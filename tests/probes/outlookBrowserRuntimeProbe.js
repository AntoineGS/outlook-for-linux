'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { app, BrowserWindow } = require('electron');

const RUNTIME_FILE = join(process.cwd(), 'app', 'browser', 'generated', 'outlookBrowserRuntime.js');
const RUNTIME_CONFIG = {
  shortcuts: { vim: { enabled: true } },
};

const COMPOSER_HTML = `<!doctype html>
<html><head><style>
  #editor { width: 320px; height: 80px; }
  #splitButton-send__primaryActionButton, #discardCompose { width: 60px; height: 24px; }
</style></head><body>
  <div id="composer">
    <div id="docking_DockingTriggerPart_1">
      <div id="editorParent_1">
        <div id="editor" contenteditable="true" role="textbox">Draft</div>
      </div>
    </div>
    <div role="toolbar"><button id="splitButton-send__primaryActionButton" data-testid="send-button">Send</button></div>
    <button id="discardCompose">Discard</button>
  </div>
</body></html>`;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  try {
    await window.loadURL(`data:text/html,${encodeURIComponent(COMPOSER_HTML)}`);
    assert.equal(await window.webContents.executeJavaScript('typeof process'), 'undefined');
    const source = await readFile(RUNTIME_FILE, 'utf8');
    const injected = source.replace('__OFL_CONFIG__', JSON.stringify(RUNTIME_CONFIG));
    await window.webContents.executeJavaScript(injected);
    await window.webContents.executeJavaScript('document.querySelector("#editor").focus()');

    const deadline = Date.now() + 3000;
    let state;
    do {
      await window.webContents.executeJavaScript('document.querySelector("#editor").focus(); document.querySelector("#editor").dispatchEvent(new FocusEvent("focusin", { bubbles: true }))');
      state = await window.webContents.executeJavaScript(`({
        initialized: globalThis.__oflOutlookVimInitialized === true,
        badges: [...document.querySelectorAll('[data-vim-mode-badge]')].map(node => node.textContent),
      })`);
      if (state.initialized && state.badges.some(value => value.includes('NORMAL'))) break;
      await sleep(50);
    } while (Date.now() < deadline);

    assert.equal(state.initialized, true);
    assert.equal(state.badges.length, 1);
    assert.equal(state.badges[0], 'NORMAL');
  } finally {
    window.destroy();
    await app.quit();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
