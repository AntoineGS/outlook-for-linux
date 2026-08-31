'use strict';

const { ipcRenderer } = require('electron');

// Keep the probe bridge shaped like production: only fixed replay IDs cross IPC.
globalThis.electronAPI = {
  replayOutlookShortcut: shortcutId => {
    if (typeof shortcutId !== 'string' || shortcutId.length > 40) return Promise.resolve(false);
    return ipcRenderer.invoke('vim-replay-outlook-shortcut', shortcutId);
  },
};
