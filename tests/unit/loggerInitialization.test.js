"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const loggerModulePath = require.resolve("../../app/config/logger");
const electronLogMainModulePath = require.resolve("electron-log/main");

test("initializes electron-log without installing a preload", () => {
  const previousLoggerModule = require.cache[loggerModulePath];
  const previousElectronLogMainModule = require.cache[electronLogMainModulePath];
  const initializeCalls = [];
  const electronLogMock = {
    functions: {},
    hooks: [],
    initialize: (options) => initializeCalls.push(options),
    transports: {
      console: {},
      file: {},
    },
  };

  require.cache[electronLogMainModulePath] = {
    id: electronLogMainModulePath,
    filename: electronLogMainModulePath,
    loaded: true,
    exports: electronLogMock,
  };
  delete require.cache[loggerModulePath];

  try {
    const logger = require("../../app/config/logger");
    logger.init({ transports: { console: { level: "info" } } });

    assert.deepStrictEqual(initializeCalls, [{ preload: false }]);
  } finally {
    if (previousLoggerModule) {
      require.cache[loggerModulePath] = previousLoggerModule;
    } else {
      delete require.cache[loggerModulePath];
    }
    if (previousElectronLogMainModule) {
      require.cache[electronLogMainModulePath] = previousElectronLogMainModule;
    } else {
      delete require.cache[electronLogMainModulePath];
    }
  }
});
