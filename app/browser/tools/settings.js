const product = require("../../product");

let _Settings_config = new WeakMap();
let _Settings_ipcRenderer = new WeakMap();
class Settings {
  init(config, ipcRenderer) {
    _Settings_config.set(this, config);
    _Settings_ipcRenderer.set(this, ipcRenderer);
    this.ipcRenderer.on(product.settingsChannels.get, retrieve);
    this.ipcRenderer.on(product.settingsChannels.set, restore);
  }

  get config() {
    return _Settings_config.get(this);
  }

  get ipcRenderer() {
    return _Settings_ipcRenderer.get(this);
  }
}

function retrieve(event) {
  event.sender.send(product.settingsChannels.get, {});
}

function restore(event) {
  event.sender.send(product.settingsChannels.set, true);
}

module.exports = new Settings();
