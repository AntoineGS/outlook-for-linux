'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const vm = require('node:vm');

const { buildOutlookBrowserRuntime } = require('../../scripts/buildOutlookBrowserRuntime');

describe('Outlook browser runtime builder', () => {
  it('generates a browser-only Vim-only IIFE', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'outlook-browser-runtime-'));
    const outputFile = join(directory, 'outlookBrowserRuntime.js');
    try {
      await buildOutlookBrowserRuntime({ outputFile });

      const source = await readFile(outputFile, 'utf8');
      assert.match(source, /__oflOutlookVimInitialized/);
      assert.doesNotMatch(source, /outlookAdSuppressor/);
      assert.match(source, /createVimBindings/);
      assert.match(source, /manageFrames:\s*!?0|manageFrames:\s*false/);
      assert.equal(source.split('__OFL_CONFIG__').length - 1, 1);
      assert.doesNotMatch(source, /\brequire\s*\(\s*['"]/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps pagehide cleanup armed through persisted events', async () => {
    const source = await readFile(require.resolve('../../app/browser/outlookBrowserRuntime'), 'utf8');
    const listeners = new Map();
    const controller = { init() {}, destroyCalls: 0, destroy() { this.destroyCalls++; } };
    const context = {
      __OFL_CONFIG__: { shortcuts: { vim: { enabled: true } } },
      require: () => ({ createVimBindings: () => controller }),
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type, listener) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };
    vm.runInNewContext(source, context);

    listeners.get('pagehide')({ persisted: true });
    assert.equal(controller.destroyCalls, 0);
    assert.equal(listeners.has('pagehide'), true);
    listeners.get('pagehide')({ persisted: false });
    assert.equal(controller.destroyCalls, 1);
    assert.equal(listeners.has('pagehide'), false);
  });

  it('cleans partial initialization and permits reinjection after failure', async () => {
    const source = await readFile(require.resolve('../../app/browser/outlookBrowserRuntime'), 'utf8');
    const listeners = new Map();
    const controllers = [];
    let shouldFail = true;
    const context = {
      __OFL_CONFIG__: { shortcuts: { vim: { enabled: true } } },
      require: () => ({ createVimBindings: () => {
        const controller = {
          destroyCalls: 0,
          init() {
            if (shouldFail) {
              shouldFail = false;
              throw new Error('init failed');
            }
          },
          destroy() { this.destroyCalls++; },
        };
        controllers.push(controller);
        return controller;
      } }),
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type, listener) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };
    const execute = () => vm.runInNewContext(`(() => { ${source}\n})()`, context);

    assert.throws(execute, /init failed/);
    assert.equal(context.__oflOutlookVimInitialized, undefined);
    assert.equal(controllers[0].destroyCalls, 1);

    execute();
    assert.equal(context.__oflOutlookVimInitialized, true);
    assert.equal(controllers.length, 2);
    assert.equal(controllers[1].destroyCalls, 0);
  });
});
