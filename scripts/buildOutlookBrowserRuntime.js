'use strict';

const { mkdir } = require('node:fs/promises');
const { dirname, join } = require('node:path');
const esbuild = require('esbuild');

const PROJECT_ROOT = join(__dirname, '..');
const ENTRY_FILE = join(PROJECT_ROOT, 'app', 'browser', 'outlookBrowserRuntime.js');
const DEFAULT_OUTPUT = join(
  PROJECT_ROOT,
  'app',
  'browser',
  'generated',
  'outlookBrowserRuntime.js',
);

/**
 * Build the browser-only Outlook runtime bundle.
 *
 * @param {{ outputFile?: string }} [options]
 * @returns {Promise<void>}
 */
async function buildOutlookBrowserRuntime({ outputFile = DEFAULT_OUTPUT } = {}) {
  await mkdir(dirname(outputFile), { recursive: true });
  await esbuild.build({
    entryPoints: [ENTRY_FILE],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    sourcemap: false,
    outfile: outputFile,
    logLevel: 'silent',
  });
}

exports.buildOutlookBrowserRuntime = buildOutlookBrowserRuntime;

exports.default = async function beforePack() {
  await buildOutlookBrowserRuntime();
};

if (require.main === module) {
  buildOutlookBrowserRuntime().catch(error => {
    console.error('Failed to build Outlook browser runtime:', error.message);
    process.exitCode = 1;
  });
}
