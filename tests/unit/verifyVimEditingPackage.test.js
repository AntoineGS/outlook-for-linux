const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateVimEditingPackage } = require('../../scripts/verifyVimEditingPackage');

const runtimeFiles = [
	'/app/browser/tools/outlookComposer.js', '/app/browser/tools/richTextPositionMap.js',
	'/app/browser/tools/richTextVimAdapter.js', '/app/browser/tools/vimBindings.js',
	'/app/browser/tools/vimCore.js', '/app/browser/tools/vimEditing.js',
];

test('package verifier accepts a clean production archive entry set', () => {
	const files = [
		'/package.json', ...runtimeFiles,
		'/node_modules/@replit/codemirror-vim-core/package.json',
	];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', "import('@replit/codemirror-vim-core')"],
	]);
	assert.deepEqual(evaluateVimEditingPackage(files, contents), []);
});

test('package verifier reports every forbidden archive rule', () => {
	const files = [
		'/package.json', ...runtimeFiles,
		'/node_modules/@replit/codemirror-vim-core/package.json',
		'/tests/e2e/authenticated/example.spec.js',
		'/app/Cookies',
	];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.2.0"}'],
		['/tests/e2e/authenticated/example.spec.js', 'task6-vim-editor __vimRichText vimRichTextSpikeBridge'],
		['/app/Cookies', 'secret'],
	]);
	const failures = evaluateVimEditingPackage(files, contents);
	assert.deepEqual(failures, [
		'@replit/codemirror-vim-core version must be exactly 0.1.0',
		'forbidden tests/reports/plans/session artifacts are present',
		'runtime Vim dynamic import is missing',
		'forbidden Vim spike or fixture identifiers are present',
	]);
});

test('package verifier fails closed when a relevant source entry cannot be extracted', () => {
	const files = [
		'/package.json', ...runtimeFiles,
		'/node_modules/@replit/codemirror-vim-core/package.json',
	];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
	]);
	assert.deepEqual(
		evaluateVimEditingPackage(files, contents, ['/app/browser/tools/vimCore.js']),
		['relevant package archive entries could not be extracted', 'runtime Vim dynamic import is missing'],
	);
});

test('package verifier requires the runtime dynamic import smoke marker', () => {
	const files = ['/package.json', ...runtimeFiles, '/node_modules/@replit/codemirror-vim-core/package.json'];
	const contents = new Map([
		['/package.json', '{"dependencies":{"@replit/codemirror-vim-core":"0.1.0"}}'],
		['/node_modules/@replit/codemirror-vim-core/package.json', '{"version":"0.1.0"}'],
		['/app/browser/tools/vimCore.js', 'production Vim loader'],
	]);
	assert.deepEqual(evaluateVimEditingPackage(files, contents), ['runtime Vim dynamic import is missing']);
});
