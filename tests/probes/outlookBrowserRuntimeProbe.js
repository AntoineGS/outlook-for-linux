'use strict';

const assert = require('node:assert/strict');
const { app, BrowserWindow } = require('electron');
const { AD_SUPPRESSION_CSS } = require('../../app/browser/tools/outlookAdSuppressor');

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

async function main() {
  await app.whenReady();
  const adWindow = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  try {
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
    console.log('PASS: Outlook ad layout reclaims reserved space');
  } finally {
    adWindow.destroy();
    app.quit();
  }
}

main().catch(error => {
  console.error(error);
  app.exit(1);
});
