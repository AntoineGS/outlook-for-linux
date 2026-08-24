const fs = require("node:fs");

/**
 * Restore a valid settings file and wait for the renderer acknowledgement.
 *
 * @param {object} options
 * @param {Electron.BrowserWindow} options.window
 * @param {string} options.settingsPath
 * @param {string} options.channel
 * @param {(handler: Function) => void} options.registerAcknowledgement
 * @param {(message: string, error?: Error) => void} options.warn
 * @param {(event: Electron.IpcMainEvent, value: any) => void} options.onAcknowledged
 * @returns {boolean} whether a restore request was sent
 */
function restoreSettingsFromFile({
  window,
  settingsPath,
  channel,
  registerAcknowledgement,
  warn,
  onAcknowledged,
}) {
  if (!fs.existsSync(settingsPath)) {
    warn("Settings file not found. Using default settings.");
    return false;
  }

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (error) {
    warn("Settings file is invalid. The file was left untouched.", error);
    return false;
  }

  registerAcknowledgement(onAcknowledged);
  window.webContents.send(channel, settings);
  return true;
}

module.exports = { restoreSettingsFromFile };
