'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { app, BrowserWindow, protocol } = require('electron');
const { AD_SUPPRESSION_CSS } = require('../../app/browser/tools/outlookAdSuppressor');
const { registerOutlookShortcutReplay } = require('../../app/outlookShortcutReplay');

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

const AD_LAYOUT_HTML = `<!doctype html>
<html><head><style>
  #container { display: flex; flex-direction: column; height: 200px; width: 320px; }
  #content { flex: 1 1 auto; min-height: 0; }
  #ad-slot { flex: 0 0 auto; height: 95px; }
</style></head><body>
  <div id="container">
    <div id="content"></div>
    <div id="ad-slot"><div><div id="direct-marker-parent"><div id="owaadbar-test"></div></div></div></div>
  </div>
</body></html>`;

const MAILBOX_HTML = `<!doctype html><html><body>
  <div role="toolbar">
    <button aria-label="New mail">New mail</button>
    <button id="read-state" aria-label="Read / Unread">Read / Unread</button>
  </div>
  <div role="listbox" aria-label="Messages">
    <div role="option" aria-label="Message" aria-selected="true" tabindex="0">Message</div>
  </div>
</body></html>`;

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function main() {
  await app.whenReady();
  protocol.handle('https', async request => new Response(
    request.url.includes('outlook.test/mailbox') ? MAILBOX_HTML : COMPOSER_HTML,
    { headers: { 'content-type': 'text/html' } },
  ));
  const ipcMain = require('electron').ipcMain;
  registerOutlookShortcutReplay({
    ipcMain,
    config: RUNTIME_CONFIG,
    product: { isAppHost: hostname => hostname === 'outlook.test' },
  });
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: false, sandbox: false,
      preload: join(__dirname, 'outlookBrowserRuntimePreload.js') },
  });
  const adWindow = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: false, sandbox: false,
      preload: join(__dirname, 'outlookBrowserRuntimePreload.js') },
  });
  const replayWindow = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: false, sandbox: false,
      preload: join(__dirname, 'outlookBrowserRuntimePreload.js') },
  });
  const replayInputs = [];
  const sendInputEvent = replayWindow.webContents.sendInputEvent.bind(replayWindow.webContents);
  replayWindow.webContents.sendInputEvent = input => {
    replayInputs.push(input);
    return sendInputEvent(input);
  };
  try {
    const source = await readFile(RUNTIME_FILE, 'utf8');
    const injected = source.replace('__OFL_CONFIG__', JSON.stringify(RUNTIME_CONFIG));
    const runComposerCase = async () => {
      await window.loadURL(`data:text/html,${encodeURIComponent(COMPOSER_HTML)}`);
      assert.equal(await window.webContents.executeJavaScript('typeof process'), 'undefined');
      await window.webContents.executeJavaScript(`
        globalThis.__outlookComposerEscapeCount = 0;
        document.addEventListener('keydown', event => {
          if (event.key === 'Escape') globalThis.__outlookComposerEscapeCount++;
        }, true);
      `);
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
      await window.webContents.executeJavaScript(`
        document.querySelector('#editor').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'i', bubbles: true })
        );
      `);
      const insertDeadline = Date.now() + 3000;
      do {
        state = await window.webContents.executeJavaScript(`({
          badges: [...document.querySelectorAll('[data-vim-mode-badge]')].map(node => node.textContent),
        })`);
        if (state.badges.length === 1 && state.badges[0] === 'INSERT') break;
        await sleep(50);
      } while (Date.now() < insertDeadline);

      assert.equal(state.badges.length, 1);
      assert.equal(state.badges[0], 'INSERT');
      await window.webContents.executeJavaScript(`
        document.querySelector('#editor').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      `);
      state = await window.webContents.executeJavaScript(`({
        badges: [...document.querySelectorAll('[data-vim-mode-badge]')].map(node => node.textContent),
        outlookEscapeCount: globalThis.__outlookComposerEscapeCount,
      })`);
      assert.deepEqual(state, { badges: ['NORMAL'], outlookEscapeCount: 0 });
      await window.webContents.executeJavaScript(`
        document.querySelector('#editor').dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      `);
      assert.equal(await window.webContents.executeJavaScript(
        'globalThis.__outlookComposerEscapeCount',
      ), 1);
      await window.webContents.executeJavaScript(`
        (() => {
          document.querySelector('#composer').remove();
          return new Promise(resolve => setTimeout(resolve, 0));
        })();
      `);
      assert.equal(await window.webContents.executeJavaScript(
        'document.querySelectorAll("[data-vim-mode-badge]").length',
      ), 0);
    };

    const runReplayCase = async () => {
      await replayWindow.loadURL('https://outlook.test/mailbox');
      await replayWindow.webContents.executeJavaScript(injected);
      assert.equal(await replayWindow.webContents.executeJavaScript(
        'typeof globalThis.electronAPI?.replayOutlookShortcut',
      ), 'function');
      assert.equal(await replayWindow.webContents.executeJavaScript(
        'globalThis.__oflOutlookVimInitialized === true',
      ), true);
      await replayWindow.webContents.executeJavaScript(`
        globalThis.__pageKeydowns = [];
        document.addEventListener('keydown', event => {
          globalThis.__pageKeydowns.push({ key: event.key, trusted: event.isTrusted });
        }, true);
      `);
      const sendPhysicalKey = async keyCode => {
        replayWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode });
        await sleep(10);
        replayWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      };

      replayWindow.webContents.focus();
      await replayWindow.webContents.executeJavaScript(
        'document.querySelector(\'[role="option"]\').focus()',
      );
      await replayWindow.webContents.executeJavaScript(`
        globalThis.__readStateClicks = 0;
        document.querySelector('#read-state').addEventListener('click', event => {
          globalThis.__readStateClicks++;
          event.currentTarget.setAttribute('aria-label', 'Mark as unread');
          event.currentTarget.textContent = 'Mark as unread';
        });
      `);
      await sleep(50);
      assert.deepEqual(await replayWindow.webContents.executeJavaScript(`({
        selected: document.querySelector('[role="option"]').getAttribute('aria-selected'),
        state: document.querySelector('#read-state').getAttribute('aria-label'),
        active: document.activeElement === document.querySelector('[role="option"]'),
      })`), { selected: 'true', state: 'Read / Unread', active: true });
      const replayInputCountBeforeQ = replayInputs.length;
      await sendPhysicalKey('q');
      await sleep(100);
      const afterRead = await replayWindow.webContents.executeJavaScript('globalThis.__pageKeydowns');
      assert.equal(afterRead.filter(event => event.trusted && event.key === 'q').length, 0);
      assert.deepEqual(await replayWindow.webContents.executeJavaScript(`({
        clicks: globalThis.__readStateClicks,
        state: document.querySelector('#read-state').getAttribute('aria-label'),
      })`), { clicks: 1, state: 'Mark as unread' });
      const qInputs = replayInputs.slice(replayInputCountBeforeQ);
      assert.deepEqual(qInputs.map(input => input.keyCode), ['q', 'q']);
      assert.deepEqual(qInputs.map(input => input.type), ['keyDown', 'keyUp']);
      await replayWindow.webContents.executeJavaScript('globalThis.__pageKeydowns = []');
      replayInputs.length = 0;
      await sendPhysicalKey('c');
      await sleep(100);
      const afterCompose = await replayWindow.webContents.executeJavaScript('globalThis.__pageKeydowns');
      const replayInputsAfterCompose = replayInputs.filter(input => input.keyCode === 'N');
      assert.deepEqual(replayInputsAfterCompose.map(input => input.type), ['keyDown', 'keyUp']);
      assert.equal(afterCompose.filter(event => event.trusted && event.key.toUpperCase() === 'N').length, 1);
      assert.equal(afterCompose.filter(event => event.trusted && event.key.toUpperCase() === 'C').length, 0);
      const replayInputCountBeforeE = replayInputs.length;
      const replayNCountBeforeE = replayInputsAfterCompose.length;
      await sendPhysicalKey('e');
      await sleep(100);
      const keydowns = await replayWindow.webContents.executeJavaScript('globalThis.__pageKeydowns');
      assert.equal(keydowns.filter(event => event.trusted).length, 2);
      assert.equal(keydowns.filter(event => event.trusted && event.key.toUpperCase() === 'C').length, 0);
      assert.equal(keydowns.filter(event => event.trusted && event.key === 'e').length, 1);
      assert.equal(keydowns.filter(event => event.trusted && event.key.toUpperCase() === 'N').length, 1);
      const inputsAfterE = replayInputs.slice(replayInputCountBeforeE);
      assert.deepEqual(inputsAfterE.map(input => input.keyCode), ['e', 'e']);
      assert.deepEqual(inputsAfterE.map(input => input.type), ['keyDown', 'keyUp']);
      assert.equal(replayInputs.filter(input => input.keyCode === 'N').length, replayNCountBeforeE);
      assert.equal(keydowns.length, afterCompose.length + 1);
    };

    const runAdCase = async () => {
      await adWindow.loadURL(`data:text/html,${encodeURIComponent(AD_LAYOUT_HTML)}`);
      const initialAdLayout = await adWindow.webContents.executeJavaScript(`({
        slotHeight: document.querySelector('#ad-slot').getBoundingClientRect().height,
        contentHeight: document.querySelector('#content').getBoundingClientRect().height,
      })`);
      assert.equal(initialAdLayout.slotHeight, 95);
      assert.equal(initialAdLayout.contentHeight, 105);
      await adWindow.webContents.executeJavaScript(`(() => {
        const style = document.createElement('style');
        style.textContent = ${JSON.stringify(AD_SUPPRESSION_CSS)};
        document.head.appendChild(style);
      })()`);
      const adLayout = await adWindow.webContents.executeJavaScript(`({
        slotHeight: document.querySelector('#ad-slot').getBoundingClientRect().height,
        contentHeight: document.querySelector('#content').getBoundingClientRect().height,
      })`);
      assert.equal(adLayout.slotHeight, 0);
      assert.equal(adLayout.contentHeight - initialAdLayout.contentHeight, 95);
    };

    const results = await Promise.allSettled([runComposerCase(), runReplayCase(), runAdCase()]);
    const rejected = results.find(result => result.status === 'rejected');
    if (rejected) throw rejected.reason;
  } finally {
    window.destroy();
    adWindow.destroy();
    replayWindow.destroy();
    protocol.unhandle('https');
    await app.quit();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
