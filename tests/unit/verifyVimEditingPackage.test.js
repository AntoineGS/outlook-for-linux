const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateVimEditingPackage: evaluateArchive } = require('../../scripts/verifyVimEditingPackage');

const runtimeFiles = [
	'/app/browser/tools/outlookComposer.js', '/app/browser/tools/richTextPositionMap.js',
	'/app/browser/tools/richTextVimAdapter.js', '/app/browser/tools/vimBindings.js',
	'/app/browser/tools/vimCore.js', '/app/browser/tools/vimEditing.js',
	'/app/browser/generated/outlookBrowserRuntime.js',
];

const cleanBrowserRuntime = `(() => {
  const runtimeConfig = __OFL_CONFIG__;
  if (!globalThis.__oflOutlookVimInitialized) globalThis.__oflOutlookVimInitialized = true;
})();`;

const evaluateVimEditingPackage = (files, contents, extractionFailures = [], expectedSource = cleanBrowserRuntime) =>
	evaluateArchive(files, contents, extractionFailures, expectedSource);

test('package verifier accepts a clean production archive entry set', () => {
	const files = [
		'/package.json', ...runtimeFiles,
		'/node_modules/@replit/codemirror-vim-core/package.json',
	];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', "import('@replit/codemirror-vim-core')"],
		['/app/browser/generated/outlookBrowserRuntime.js', cleanBrowserRuntime],
	]);
	assert.deepEqual(evaluateVimEditingPackage(files, contents), []);
});

test('package verifier reports every forbidden archive rule', () => {
	const files = [
		'/package.json', ...runtimeFiles,
		'/node_modules/@replit/codemirror-vim-core/package.json',
		'/tests/e2e/authenticated/example.spec.js',
		'/app/Cookies',
		'/docs/superpowers/reports/review.md',
	];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.2.0"}'],
		['/tests/e2e/authenticated/example.spec.js', 'task6-vim-editor __vimRichText vimRichTextSpikeBridge'],
		['/app/Cookies', 'secret'],
		['/docs/superpowers/reports/review.md', 'review'],
		['/app/browser/generated/outlookBrowserRuntime.js', cleanBrowserRuntime],
	]);
	const failures = evaluateVimEditingPackage(files, contents);
	assert.deepEqual(failures, [
		'@replit/codemirror-vim-core version must be exactly 0.1.0',
		'forbidden tests/reports/plans/session artifacts are present',
		'runtime Vim dynamic import is missing',
		'forbidden Vim spike or fixture identifiers are present',
	]);
});

test('package build excludes the exact superpowers reports tree', () => {
	const packageJson = require('../../package.json');
	assert.ok(packageJson.build.files.includes('!docs/superpowers/reports{,/**/*}'));
});

test('package verifier rejects report directories at every archive depth', () => {
	for (const reportPath of ['/docs/superpowers/reports', '/docs/superpowers/reports/nested/report.md']) {
		const files = ['/package.json', ...runtimeFiles, '/node_modules/@replit/codemirror-vim-core/package.json', reportPath];
		const contents = new Map([
			['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
			['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
			['/app/browser/tools/vimCore.js', "import('@replit/codemirror-vim-core')"],
			['/app/browser/generated/outlookBrowserRuntime.js', cleanBrowserRuntime],
		]);

		assert.deepEqual(evaluateVimEditingPackage(files, contents), ['forbidden tests/reports/plans/session artifacts are present']);
	}
});

test('package verifier fails closed when a relevant source entry cannot be extracted', () => {
	const files = [
		'/package.json', ...runtimeFiles,
		'/node_modules/@replit/codemirror-vim-core/package.json',
	];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/generated/outlookBrowserRuntime.js', cleanBrowserRuntime],
	]);
	assert.deepEqual(
		evaluateVimEditingPackage(files, contents, ['/app/browser/tools/vimCore.js']),
		['relevant package archive entries could not be extracted', 'runtime Vim dynamic import is missing'],
	);
});

test('package verifier rejects project-local worktree entries', () => {
	const files = [
		'/package.json', ...runtimeFiles,
		'/node_modules/@replit/codemirror-vim-core/package.json',
		'/.worktrees/feature/app/index.js',
	];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', "import('@replit/codemirror-vim-core')"],
		['/app/browser/generated/outlookBrowserRuntime.js', cleanBrowserRuntime],
	]);

	assert.deepEqual(
		evaluateVimEditingPackage(files, contents),
		['forbidden tests/reports/plans/session artifacts are present'],
	);
});

test('package verifier requires the runtime dynamic import smoke marker', () => {
	const files = ['/package.json', ...runtimeFiles, '/node_modules/@replit/codemirror-vim-core/package.json'];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', 'production Vim loader'],
		['/app/browser/generated/outlookBrowserRuntime.js', cleanBrowserRuntime],
	]);
	assert.deepEqual(evaluateVimEditingPackage(files, contents), ['runtime Vim dynamic import is missing']);
});

test('package verifier rejects an absent generated browser runtime', () => {
	const files = ['/package.json', ...runtimeFiles.filter(file => !file.includes('/generated/')), '/node_modules/@replit/codemirror-vim-core/package.json'];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', "import('@replit/codemirror-vim-core')"],
	]);

	assert.deepEqual(evaluateVimEditingPackage(files, contents), ['generated Outlook browser runtime is missing']);
});

test('package verifier rejects unsafe or incomplete generated browser runtime code', () => {
	const files = ['/package.json', ...runtimeFiles, '/node_modules/@replit/codemirror-vim-core/package.json'];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', "import('@replit/codemirror-vim-core')"],
		['/app/browser/generated/outlookBrowserRuntime.js', 'const x = require("electron"); process.platform; outlookAdSuppressor(); __OFL_CONFIG__; __OFL_CONFIG__;'],
	]);

	assert.deepEqual(evaluateVimEditingPackage(files, contents, [], 'const x = require("electron"); process.platform; outlookAdSuppressor(); __OFL_CONFIG__; __OFL_CONFIG__;'), [
		'generated Outlook browser runtime is not an IIFE',
		'generated Outlook browser runtime must contain exactly one __OFL_CONFIG__ token',
		'generated Outlook browser runtime initialization marker is missing',
		'generated Outlook browser runtime contains unresolved CommonJS require calls',
		'generated Outlook browser runtime contains a browser-unsafe process dependency',
		'generated Outlook browser runtime contains ad suppressor code',
	]);
});

test('package verifier fails closed when generated runtime extraction fails', () => {
	const files = ['/package.json', ...runtimeFiles, '/node_modules/@replit/codemirror-vim-core/package.json'];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', "import('@replit/codemirror-vim-core')"],
	]);

	assert.deepEqual(evaluateVimEditingPackage(files, contents, ['/app/browser/generated/outlookBrowserRuntime.js']), [
		'relevant package archive entries could not be extracted',
		'generated Outlook browser runtime could not be inspected',
	]);
});

test('package verifier rejects malformed generated browser runtime source', () => {
	const files = ['/package.json', ...runtimeFiles, '/node_modules/@replit/codemirror-vim-core/package.json'];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', "import('@replit/codemirror-vim-core')"],
		['/app/browser/generated/outlookBrowserRuntime.js', '(() => { __OFL_CONFIG__; globalThis.__oflOutlookVimInitialized = true;'],
	]);

	assert.deepEqual(evaluateVimEditingPackage(files, contents, [], '(() => { __OFL_CONFIG__; globalThis.__oflOutlookVimInitialized = true;'), [
		'generated Outlook browser runtime source is not valid JavaScript',
		'generated Outlook browser runtime is not an IIFE',
	]);
});

test('package verifier rejects valid but incomplete generated browser runtime source', () => {
	const files = ['/package.json', ...runtimeFiles, '/node_modules/@replit/codemirror-vim-core/package.json'];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', "import('@replit/codemirror-vim-core')"],
		['/app/browser/generated/outlookBrowserRuntime.js', '(() => {})()'],
	]);

	assert.deepEqual(evaluateVimEditingPackage(files, contents, [], '(() => {})()'), [
		'generated Outlook browser runtime is not an IIFE',
		'generated Outlook browser runtime must contain exactly one __OFL_CONFIG__ token',
		'generated Outlook browser runtime initialization marker is missing',
	]);
});

test('package verifier rejects generated browser runtime source differing from expected build', () => {
	const files = ['/package.json', ...runtimeFiles, '/node_modules/@replit/codemirror-vim-core/package.json'];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', "import('@replit/codemirror-vim-core')"],
		['/app/browser/generated/outlookBrowserRuntime.js', cleanBrowserRuntime.replace('true', 'false')],
	]);

	assert.deepEqual(evaluateVimEditingPackage(files, contents), [
		'packaged Outlook browser runtime differs from the fresh expected build',
	]);
});

test('package verifier fails closed when no expected generated source is supplied', () => {
	const files = ['/package.json', ...runtimeFiles, '/node_modules/@replit/codemirror-vim-core/package.json'];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', "import('@replit/codemirror-vim-core')"],
		['/app/browser/generated/outlookBrowserRuntime.js', cleanBrowserRuntime],
	]);

	assert.deepEqual(evaluateArchive(files, contents), [
		'fresh expected Outlook browser runtime is missing',
	]);
});
