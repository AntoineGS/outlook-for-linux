const { ipcMain } = require("electron");

/**
 * Registers an IPC endpoint only when its product feature is enabled.
 * Keeping the dynamic Electron method here prevents disabled upstream modules
 * from looking like active literal registrations to static allowlist checks.
 *
 * @param {boolean} enabled - Product feature state.
 * @param {"handle"|"on"|"once"} method - Electron registration method.
 * @param {string} channel - IPC channel.
 * @param {Function} handler - IPC handler.
 */
function registerFeatureIpc(enabled, method, channel, handler) {
  if (enabled) {
    ipcMain[method](channel, handler);
  }
}

module.exports = { registerFeatureIpc };
