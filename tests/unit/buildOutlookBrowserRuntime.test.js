const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

test('builds a self-contained Outlook browser runtime', async () => {
	let buildOutlookBrowserRuntime;
	try {
		({ buildOutlookBrowserRuntime } = require('../../scripts/buildOutlookBrowserRuntime'));
	} catch {}
	assert.equal(typeof buildOutlookBrowserRuntime, 'function');
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-runtime-build-'));
	try {
		const outputPath = path.join(directory, 'runtime.js');
		await buildOutlookBrowserRuntime(outputPath);
		const source = fs.readFileSync(outputPath, 'utf8');
		assert.ok(source.length > 1000);
		assert.match(source, /__OFL_CONFIG__/);
		assert.doesNotMatch(source, /import\(["']@replit\/codemirror-vim-core/);
		assert.doesNotThrow(() => new vm.Script(source));
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
