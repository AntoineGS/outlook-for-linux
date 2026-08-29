'use strict';
/* global __OFL_CONFIG__ */

const { createVimBindings } = require('./tools/vimBindings');

if (!globalThis.__oflOutlookVimInitialized) {
  let vimController;
  try {
    const runtimeConfig = __OFL_CONFIG__;
    vimController = createVimBindings({
      document: globalThis.document,
      MutationObserverClass: globalThis.MutationObserver,
    });
    vimController.init(runtimeConfig);
    const pagehideHandler = event => {
      if (event.persisted) return;
      globalThis.removeEventListener('pagehide', pagehideHandler);
      vimController.destroy();
    };
    globalThis.addEventListener('pagehide', pagehideHandler);
    globalThis.__oflOutlookVimInitialized = true;
  } catch (error) {
    try { vimController?.destroy?.(); } catch { /* Preserve the initialization error. */ }
    delete globalThis.__oflOutlookVimInitialized;
    throw error;
  }
}
