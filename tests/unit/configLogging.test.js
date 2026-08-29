'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

test('config loader never captures path, username, or secret values in startup logs', () => {
  const configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-config-'));
  const configFile = path.join(configDirectory, 'config.json');
  const sentinels = ['sentinel-user@example.test', 'sentinel-config-path', 'sentinel-secret'];
  fs.writeFileSync(configFile, '{}');

  const electronPath = require.resolve('electron');
  const loggerPath = require.resolve('../../app/config/logger');
  const configPath = require.resolve('../../app/config');
  const originalElectron = require.cache[electronPath];
  const originalLogger = require.cache[loggerPath];
  const originalLoad = Module._load;
  const originalConsole = Object.fromEntries(
    ['info', 'warn', 'debug'].map((method) => [method, console[method]]),
  );
  const captured = [];

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: { ipcMain: { emit() {} } },
  };
  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: { init() {} },
  };
  Module._load = function load(request, parent, isMain) {
    if (request.endsWith('/config.json')) {
      throw new Error(`failed for ${sentinels[0]} ${sentinels[2]} at ${sentinels[1]}`);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  for (const method of ['info', 'warn', 'debug']) {
    console[method] = (...args) => captured.push(args.join(' '));
  }

  try {
    delete require.cache[configPath];
    delete require.cache[configFile];
    const loadConfig = require(configPath);
    loadConfig(configDirectory, '2.0.0');
  } finally {
    Module._load = originalLoad;
    Object.assign(console, originalConsole);
    if (originalElectron) require.cache[electronPath] = originalElectron;
    else delete require.cache[electronPath];
    if (originalLogger) require.cache[loggerPath] = originalLogger;
    else delete require.cache[loggerPath];
    delete require.cache[configPath];
    fs.rmSync(configDirectory, { recursive: true, force: true });
  }

  assert.ok(captured.some((message) => message.toLowerCase().includes('user configuration')));
  for (const sentinel of sentinels) {
    assert.ok(!captured.join('\n').includes(sentinel), `log leaked ${sentinel}`);
  }
});
