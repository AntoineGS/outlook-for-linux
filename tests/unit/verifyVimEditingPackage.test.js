const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateVimEditingPackage: evaluateArchive } = require('../../scripts/verifyVimEditingPackage');

const GENERATED_RUNTIME_PATH = '/app/browser/generated/outlookBrowserRuntime.js';
const cleanBrowserRuntime = `(() => {
  const runtimeConfig = __OFL_CONFIG__;
  if (!globalThis.__oflOutlookVimInitialized) globalThis.__oflOutlookVimInitialized = true;
})();`;

const evaluateVimEditingPackage = (files, contents, extractionFailures = [], expectedSource = cleanBrowserRuntime) =>
	evaluateArchive(files, contents, extractionFailures, expectedSource);

test('package verifier accepts a generated runtime and ordinary production files', () => {
	const files = ['/package.json', GENERATED_RUNTIME_PATH, '/app/index.js'];
	const contents = new Map([
		[GENERATED_RUNTIME_PATH, cleanBrowserRuntime],
	]);

	assert.deepEqual(evaluateVimEditingPackage(files, contents), []);
});

test('package config excludes non-runtime and bundle-input content', () => {
	const pkg = require('../../package.json');
	for (const pattern of [
		'!docs-site{,/**/*}',
		'!scripts{,/**/*}',
		'!app/assets/icons/T4L Logo 2024.zip',
		'!app/browser/outlookBrowserRuntime.js',
		'!app/browser/tools/{outlookActions,outlookComposer,richTextPositionMap,richTextVimAdapter,vimBindings,vimCore,vimEditing}.js',
	]) {
		assert.ok(pkg.build.files.includes(pattern), pattern);
	}
	assert.equal(pkg.scripts.prepack, undefined);
	assert.equal(pkg.build.beforePack, 'scripts/buildOutlookBrowserRuntime.js');
	assert.equal(pkg.dependencies['@replit/codemirror-vim-core'], undefined);
	assert.equal(pkg.devDependencies['@replit/codemirror-vim-core'], '0.1.0');
	assert.equal(pkg.devDependencies['@electron/asar'], '3.4.1');
});

for (const forbiddenPath of [
	'/docs-site/docs/index.md',
	'/scripts/verifyVimEditingPackage.js',
	'/app/assets/icons/T4L Logo 2024.zip',
	'/app/browser/outlookBrowserRuntime.js',
	'/app/browser/tools/vimCore.js',
	'/node_modules/@replit/codemirror-vim-core/package.json',
]) {
	test(`package verifier rejects forbidden package path: ${forbiddenPath}`, () => {
		const files = ['/package.json', GENERATED_RUNTIME_PATH, forbiddenPath];
		const contents = new Map([[GENERATED_RUNTIME_PATH, cleanBrowserRuntime]]);

		assert.deepEqual(evaluateVimEditingPackage(files, contents), [
			'forbidden tests/reports/plans/session artifacts are present',
		]);
	});
}

test('package verifier rejects forbidden identifiers in the generated runtime', () => {
	const runtime = cleanBrowserRuntime.replace('})();', 'globalThis.task6_vim_editor = __vimRichText; })();');
	const files = ['/package.json', GENERATED_RUNTIME_PATH];
	const contents = new Map([[GENERATED_RUNTIME_PATH, runtime]]);

	assert.deepEqual(evaluateVimEditingPackage(files, contents, [], runtime), [
		'forbidden Vim spike or fixture identifiers are present',
	]);
});

test('package verifier rejects an absent generated browser runtime', () => {
	assert.deepEqual(evaluateVimEditingPackage(['/package.json'], new Map()), [
		'generated Outlook browser runtime is missing',
	]);
});

test('package verifier fails closed when generated runtime extraction fails', () => {
	const files = ['/package.json', GENERATED_RUNTIME_PATH];
	const contents = new Map();

	assert.deepEqual(evaluateVimEditingPackage(files, contents, [GENERATED_RUNTIME_PATH]), [
		'relevant package archive entries could not be extracted',
		'generated Outlook browser runtime could not be inspected',
	]);
});

test('package verifier rejects unsafe or incomplete generated browser runtime code', () => {
	const runtime = 'const x = require("electron"); process.platform; outlookAdSuppressor(); __OFL_CONFIG__; __OFL_CONFIG__;';
	const files = ['/package.json', GENERATED_RUNTIME_PATH];
	const contents = new Map([[GENERATED_RUNTIME_PATH, runtime]]);

	assert.deepEqual(evaluateVimEditingPackage(files, contents, [], runtime), [
		'generated Outlook browser runtime is not an IIFE',
		'generated Outlook browser runtime must contain exactly one __OFL_CONFIG__ token',
		'generated Outlook browser runtime initialization marker is missing',
		'generated Outlook browser runtime contains unresolved CommonJS require calls',
		'generated Outlook browser runtime contains a browser-unsafe process dependency',
		'generated Outlook browser runtime contains ad suppressor code',
	]);
});

test('package verifier rejects malformed generated browser runtime source', () => {
	const runtime = '(() => {';
	const files = ['/package.json', GENERATED_RUNTIME_PATH];
	const contents = new Map([[GENERATED_RUNTIME_PATH, runtime]]);

	assert.deepEqual(evaluateVimEditingPackage(files, contents, [], runtime), [
		'generated Outlook browser runtime source is not valid JavaScript',
		'generated Outlook browser runtime is not an IIFE',
		'generated Outlook browser runtime must contain exactly one __OFL_CONFIG__ token',
		'generated Outlook browser runtime initialization marker is missing',
	]);
});

test('package verifier rejects generated browser runtime source differing from expected build', () => {
	const files = ['/package.json', GENERATED_RUNTIME_PATH];
	const contents = new Map([[GENERATED_RUNTIME_PATH, cleanBrowserRuntime.replace('true', 'false')]]);

	assert.deepEqual(evaluateVimEditingPackage(files, contents), [
		'packaged Outlook browser runtime differs from the fresh expected build',
	]);
});

test('package verifier fails closed when no expected generated source is supplied', () => {
	const files = ['/package.json', GENERATED_RUNTIME_PATH];
	const contents = new Map([[GENERATED_RUNTIME_PATH, cleanBrowserRuntime]]);

	assert.deepEqual(evaluateArchive(files, contents), [
		'fresh expected Outlook browser runtime is missing',
	]);
});
