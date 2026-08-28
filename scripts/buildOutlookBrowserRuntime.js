const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const DEFAULT_OUTPUT = path.join(__dirname, '..', 'app', 'browser', 'generated', 'outlookBrowserRuntime.js');

async function buildOutlookBrowserRuntime(outputPath = DEFAULT_OUTPUT) {
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	await esbuild.build({
		entryPoints: [path.join(__dirname, '..', 'app', 'browser', 'outlookBrowserRuntime.js')],
		bundle: true,
		platform: 'browser',
		format: 'iife',
		target: 'chrome130',
		outfile: outputPath,
		define: { 'process.platform': JSON.stringify(process.platform) },
		logLevel: 'silent',
	});
}

async function beforePack() {
	await buildOutlookBrowserRuntime();
}

beforePack.buildOutlookBrowserRuntime = buildOutlookBrowserRuntime;
module.exports = beforePack;

if (require.main === module) {
	buildOutlookBrowserRuntime().catch(error => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
